const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

// Función principal del bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['ArletteBot', 'Chrome', '1.0.0'],
        version
    });

    // Guardar credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Manejar actualizaciones de conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Mostrar QR cuando esté disponible
        if (qr) {
            console.clear();
            console.log('🤖 ArletteBot - Código QR');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📱 Escanea este código con WhatsApp:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('💡 WhatsApp > ⋮ > Dispositivos vinculados > Vincular dispositivo');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log('❌ Conexión cerrada. Reconectando en 3 segundos...');
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('❌ Sesión cerrada. Por favor elimina la carpeta auth_info y vuelve a ejecutar.');
            }
        } else if (connection === 'open') {
            console.clear();
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ Bot conectado exitosamente!');
            console.log('🤖 ArletteBot está listo para usar');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📝 Comandos disponibles:');
            console.log('   • .todos [mensaje] - Menciona a todos en el grupo');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        } else if (connection === 'connecting') {
            console.log('⏳ Conectando...');
        }
    });

    // Manejar mensajes entrantes
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];

            // Ignorar mensajes sin contenido o del propio bot
            if (!msg.message || msg.key.fromMe) return;

            // Obtener el texto del mensaje
            const messageText = msg.message.conversation ||
                msg.message.extendedTextMessage?.text || '';

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            // Comando .todos
            if (messageText.toLowerCase().startsWith('.todos')) {
                if (!isGroup) {
                    await sock.sendMessage(from, {
                        text: '❌ Este comando solo funciona en grupos.'
                    });
                    return;
                }

                try {
                    // Obtener metadata del grupo
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;

                    // Obtener el mensaje después del comando
                    const customMessage = messageText.slice(6).trim();
                    const mensaje = customMessage || '¡Atención a todos! 📢';

                    // Crear el mensaje mencionando a todos
                    let mentions = [];
                    let text = `${mensaje}\n\n`;

                    participants.forEach((participant) => {
                        const number = participant.id.split('@')[0];
                        text += `@${number} `;
                        mentions.push(participant.id);
                    });

                    // Enviar mensaje con menciones
                    await sock.sendMessage(from, {
                        text: text,
                        mentions: mentions
                    });

                    //console.log(`✅ Comando .todos ejecutado en: ${groupMetadata.subject}`);

                } catch (error) {
                    //console.error('❌ Error al ejecutar .todos:', error);
                    await sock.sendMessage(from, {
                        text: '❌ Error al mencionar a los participantes.'
                    });
                }
            }

        } catch (error) {
            //console.error('❌ Error procesando mensaje:', error);
        }
    });
}

// Iniciar el bot con manejo de errores
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 Iniciando ArletteBot...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

startBot().catch(err => {
    console.error('❌ Error al iniciar bot:', err);
    process.exit(1);
});