const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const https = require('https');

// Crear servidor Express para mantener activo el servicio
const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = null;
let isConnected = false;
let botStatus = 'Iniciando...';

// Middleware básico
app.use(express.json());

// Ruta de salud para Render
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: isConnected ? 'conectado' : 'desconectado',
        message: botStatus,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Ruta para ver el QR en el navegador
app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>ArletteBot - QR Code</title>
                <meta charset="utf-8">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #0a0a0a;
                        color: white;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        background: #1a1a1a;
                        padding: 30px;
                        border-radius: 15px;
                        box-shadow: 0 0 30px rgba(0,0,0,0.5);
                        text-align: center;
                        max-width: 500px;
                    }
                    h1 { color: #00ff88; margin-bottom: 10px; }
                    .qr-container {
                        background: white;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                        display: inline-block;
                    }
                    img { max-width: 100%; height: auto; }
                    .instructions {
                        text-align: left;
                        background: #2a2a2a;
                        padding: 15px;
                        border-radius: 8px;
                        margin-top: 20px;
                    }
                    .instructions ol { margin: 10px 0; padding-left: 20px; }
                    .instructions li { margin: 8px 0; }
                    .refresh {
                        margin-top: 20px;
                        color: #888;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 ArletteBot</h1>
                    <p>Escanea el código QR con WhatsApp</p>
                    <div class="qr-container">
                        <img src="${qrCodeData}" alt="QR Code">
                    </div>
                    <div class="instructions">
                        <strong>📱 Cómo escanear:</strong>
                        <ol>
                            <li>Abre WhatsApp en tu teléfono</li>
                            <li>Toca el menú (⋮) o Configuración</li>
                            <li>Selecciona "Dispositivos vinculados"</li>
                            <li>Toca "Vincular un dispositivo"</li>
                            <li>Escanea este código QR</li>
                        </ol>
                    </div>
                    <div class="refresh">
                        La página se actualizará automáticamente cada 5 segundos
                    </div>
                </div>
                <script>
                    setTimeout(() => location.reload(), 5000);
                </script>
            </body>
            </html>
        `);
    } else if (isConnected) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>ArletteBot - Conectado</title>
                <meta charset="utf-8">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #0a0a0a;
                        color: white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .container {
                        background: #1a1a1a;
                        padding: 40px;
                        border-radius: 15px;
                        text-align: center;
                    }
                    h1 { color: #00ff88; font-size: 48px; margin: 0; }
                    p { color: #888; margin-top: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Bot Conectado</h1>
                    <p>ArletteBot está funcionando correctamente</p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>ArletteBot - Esperando</title>
                <meta charset="utf-8">
                <meta http-equiv="refresh" content="3">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #0a0a0a;
                        color: white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .container {
                        background: #1a1a1a;
                        padding: 40px;
                        border-radius: 15px;
                        text-align: center;
                    }
                    h1 { color: #ffaa00; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>⏳ Esperando código QR...</h1>
                    <p>Actualizando...</p>
                </div>
            </body>
            </html>
        `);
    }
});

// Ruta de estado del bot
app.get('/status', (req, res) => {
    res.json({
        connected: isConnected,
        status: botStatus,
        hasQR: qrCodeData !== null,
        uptime: process.uptime(),
        lastPing: new Date().toISOString()
    });
});

// Ruta de health check específica para monitoreo
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'ArletteBot',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        botConnected: isConnected
    });
});

// Ruta de ping interno
app.get('/ping', (req, res) => {
    res.json({ 
        pong: true, 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// =============================================================================
// SISTEMA DE AUTO-PING PARA EVITAR QUE RENDER SE DUERMA
// =============================================================================

class KeepAliveManager {
    constructor() {
        this.pingInterval = null;
        this.lastPingTime = null;
        this.pingCount = 0;
    }

    start() {
        console.log('🔄 Iniciando sistema de auto-ping...');
        
        // Ping cada 8 minutos (480,000 ms)
        this.pingInterval = setInterval(() => {
            this.pingSelf();
        }, 8 * 60 * 1000);

        // Primer ping inmediato
        setTimeout(() => this.pingSelf(), 5000);
        
        console.log('✅ Sistema de auto-ping activado (cada 8 minutos)');
    }

    async pingSelf() {
        try {
            const url = `http://localhost:${PORT}/ping`;
            const response = await fetch(url);
            const data = await response.json();
            
            this.lastPingTime = new Date();
            this.pingCount++;
            
            console.log(`📡 Auto-ping #${this.pingCount} - ${this.lastPingTime.toLocaleTimeString()}`);
            
        } catch (error) {
            console.error('❌ Error en auto-ping:', error.message);
        }
    }

    stop() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            console.log('🛑 Sistema de auto-ping detenido');
        }
    }

    getStatus() {
        return {
            active: this.pingInterval !== null,
            lastPing: this.lastPingTime,
            totalPings: this.pingCount
        };
    }
}

// Crear instancia del gestor de keep-alive
const keepAliveManager = new KeepAliveManager();

// =============================================================================
// INICIALIZACIÓN DEL SERVIDOR
// =============================================================================

// Iniciar servidor Express
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🌐 Servidor web iniciado en puerto ${PORT}`);
    console.log(`📱 Visita /qr para ver el código QR`);
    console.log(`❤️  Ruta de health: /health`);
    console.log(`🔄 Auto-ping activado`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});

// Iniciar sistema de auto-ping después de que el servidor esté listo
server.on('listening', () => {
    setTimeout(() => {
        keepAliveManager.start();
    }, 3000);
});

// Ruta para ver estado del sistema de keep-alive
app.get('/keep-alive-status', (req, res) => {
    res.json({
        keepAlive: keepAliveManager.getStatus(),
        server: {
            port: PORT,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        },
        bot: {
            connected: isConnected,
            status: botStatus
        }
    });
});

// =============================================================================
// FUNCIÓN PRINCIPAL DEL BOT
// =============================================================================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['ArletteBot', 'Chrome', '1.0.0'],
        version
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 Nuevo código QR generado');
            botStatus = 'QR generado - Esperando escaneo';
            
            // Convertir QR a data URL para mostrar en navegador
            const QRCode = require('qrcode');
            qrCodeData = await QRCode.toDataURL(qr);
            
            // También mostrar en consola
            qrcode.generate(qr, { small: true });
            console.log(`\n🌐 Visita /qr para ver el código QR en el navegador`);
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                console.log('❌ Conexión cerrada. Reconectando en 3 segundos...');
                botStatus = 'Reconectando...';
                isConnected = false;
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('❌ Sesión cerrada.');
                botStatus = 'Sesión cerrada';
                isConnected = false;
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado exitosamente!');
            botStatus = 'Conectado y funcionando';
            isConnected = true;
            qrCodeData = null; // Limpiar QR al conectar
        } else if (connection === 'connecting') {
            console.log('⏳ Conectando...');
            botStatus = 'Conectando...';
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            
            if (!msg.message || msg.key.fromMe) return;
            
            const messageText = msg.message.conversation || 
                              msg.message.extendedTextMessage?.text || '';
            
            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            
            if (messageText.toLowerCase().startsWith('.todos')) {
                if (!isGroup) {
                    await sock.sendMessage(from, { 
                        text: '❌ Este comando solo funciona en grupos.' 
                    });
                    return;
                }

                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    
                    const customMessage = messageText.slice(6).trim();
                    const mensaje = customMessage || '¡Atención a todos! 📢';
                    
                    let mentions = [];
                    let text = `${mensaje}\n\n`;
                    
                    participants.forEach((participant) => {
                        const number = participant.id.split('@')[0];
                        text += `@${number} `;
                        mentions.push(participant.id);
                    });
                    
                    await sock.sendMessage(from, {
                        text: text,
                        mentions: mentions
                    });
                    
                    console.log(`✅ Comando .todos ejecutado en: ${groupMetadata.subject}`);
                    
                } catch (error) {
                    console.error('❌ Error al ejecutar .todos:', error);
                    await sock.sendMessage(from, { 
                        text: '❌ Error al mencionar a los participantes.' 
                    });
                }
            }
            
        } catch (error) {
            console.error('❌ Error procesando mensaje:', error);
        }
    });
}

// =============================================================================
// MANEJO DE APAGADO GRACIAL
// =============================================================================

process.on('SIGINT', () => {
    console.log('\n🛑 Apagando ArletteBot...');
    keepAliveManager.stop();
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Render está apagando la instancia...');
    keepAliveManager.stop();
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

// =============================================================================
// INICIO DE LA APLICACIÓN
// =============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 Iniciando ArletteBot...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Iniciar bot después del servidor
setTimeout(() => {
    startBot().catch(err => {
        console.error('❌ Error al iniciar bot:', err);
        botStatus = 'Error al iniciar';
    });
}, 2000);
