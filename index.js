require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();

// Configuration
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const PORT = process.env.PORT || 8000;
const MAX_QUEUE_SIZE = 100;

// Validate environment variables
if (!TOKEN || isNaN(ADMIN_ID)) {
    console.error('Error: TELEGRAM_BOT_TOKEN or ADMIN_ID is missing or invalid in .env file');
    process.exit(1);
}

// Initialize bot with polling disabled initially
const bot = new TelegramBot(TOKEN, { polling: false });

// Store user chats {user_id: last_message_id}
const userChats = new Map();

// Message queue for rate limiting
const messageQueue = [];
let isProcessingQueue = false;

// URL and location validation
const isValidUrl = (url) => {
    try {
        new URL(url);
        return url.match(/\.(jpg|jpeg|png|gif|mp4|pdf)$/i) !== null; // Ruxsat etilgan formatlar
    } catch {
        return false;
    }
};

const isValidLocation = (lat, lon) => {
    return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
};

// Process message queue
async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;
    const { type, data } = messageQueue.shift();

    try {
        switch (type) {
            case 'message':
                await bot.sendMessage(data.chatId, data.text, data.options);
                break;
            case 'photo':
                await bot.sendPhoto(data.chatId, data.url, data.options);
                break;
            case 'video':
                await bot.sendVideo(data.chatId, data.url, data.options);
                break;
            case 'document':
                await bot.sendDocument(data.chatId, data.url, data.options);
                break;
            case 'location':
                await bot.sendLocation(data.chatId, data.latitude, data.longitude, data.options);
                break;
        }
    } catch (error) {
        console.error(`Error processing ${type}:`, error.response?.body || error.message);
        queueMessage('message', {
            chatId: ADMIN_ID,
            text: `⚠️ ${type} yuborishda xatolik: ${error.response?.body?.description || error.message}`,
            options: { reply_to_message_id: data.options?.reply_to_message_id }
        });
    }

    isProcessingQueue = false;
    if (messageQueue.length > 0) processQueue();
}

// Queue message sending
function queueMessage(type, data) {
    if (messageQueue.length >= MAX_QUEUE_SIZE) {
        console.warn('Queue is full, rejecting new message');
        queueMessage('message', {
            chatId: ADMIN_ID,
            text: '⚠️ Tizim band, iltimos keyinroq urinib ko‘ring!'
        });
        return;
    }
    messageQueue.push({ type, data });
    processQueue();
}

// Send welcome message
function sendWelcome(chatId) {
    const welcomeText = "🤖 Assalomu alaykum!\n\nSizning savollaringizni call-markaz qabul qiladi va tez orada javob beradi. Xabaringizni yozing!";
    queueMessage('message', {
        chatId,
        text: welcomeText
    });
}

// Handle bot messages
bot.on('message', async (msg) => {
    console.log(`Received message from chat ${msg.chat.id}:`, msg);
    const chatId = msg.chat.id;
    const userFirstName = msg.from?.first_name || 'Anonim';
    const messageId = msg.message_id;

    try {
        if (msg.text?.trim() === '/start' && chatId !== ADMIN_ID) {
            sendWelcome(chatId);
            if (!userChats.has(chatId)) {
                const initialMsg = `👤 Yangi mijoz: ${userFirstName} (ID: ${chatId})\n📝 Suhbat boshlandi!`;
                const sentMsg = await bot.sendMessage(ADMIN_ID, initialMsg, { parse_mode: 'HTML' });
                userChats.set(chatId, sentMsg.message_id);
            }
        } else if (chatId !== ADMIN_ID && userChats.has(chatId)) {
            let newMsg = `👤 ${userFirstName} (ID: ${chatId}):\n`;
            if (msg.text) {
                newMsg += `📝 ${msg.text}`;
            } else if (msg.photo) {
                newMsg += `🖼️ Foydalanuvchi rasm yubordi`;
            } else if (msg.video) {
                newMsg += `🎥 Foydalanuvchi video yubordi`;
            } else if (msg.document) {
                newMsg += `📄 Foydalanuvchi hujjat yubordi`;
            } else {
                newMsg += `📎 Boshqa turdagi xabar`;
            }
            const sentMsg = await bot.sendMessage(ADMIN_ID, newMsg, { // SENDMessage -> sendMessage
                parse_mode: 'HTML',
                reply_to_message_id: userChats.get(chatId)
            });
            userChats.set(chatId, sentMsg.message_id);

            // Forward non-text content to admin
            if (msg.photo) {
                await bot.sendPhoto(ADMIN_ID, msg.photo[msg.photo.length - 1].file_id, {
                    reply_to_message_id: sentMsg.message_id
                });
            } else if (msg.video) {
                await bot.sendVideo(ADMIN_ID, msg.video.file_id, {
                    reply_to_message_id: sentMsg.message_id
                });
            } else if (msg.document) {
                await bot.sendDocument(ADMIN_ID, msg.document.file_id, {
                    reply_to_message_id: sentMsg.message_id
                });
            }
        } else if (chatId === ADMIN_ID && msg.reply_to_message) {
            const replyMsgId = msg.reply_to_message.message_id;
            let userId = null;

// 80

            for (const [uid, mid] of userChats) {
                if (mid === replyMsgId) {
                    userId = uid;
                    break;
                }
            }

            if (!userId) {
                queueMessage('message', {
                    chatId: ADMIN_ID,
                    text: "⚠️ Bu xabarni foydalanuvchiga yuborib bo'lmaydi.",
                    options: { reply_to_message_id: replyMsgId }
                });
                return;
            }

            // Admin tomonidan yuborilgan media fayllarni qayta yuborish
            if (msg.photo) {
                await bot.sendPhoto(userId, msg.photo[msg.photo.length - 1].file_id, {
                    caption: msg.caption || ''
                });
                queueMessage('message', {
                    chatId: ADMIN_ID,
                    text: "✅ Rasm yuborildi!",
                    options: { reply_to_message_id: replyMsgId }
                });
            } else if (msg.video) {
                await bot.sendVideo(userId, msg.video.file_id, {
                    caption: msg.caption || ''
                });
                queueMessage('message', {
                    chatId: ADMIN_ID,
                    text: "✅ Video yuborildi!",
                    options: { reply_to_message_id: replyMsgId }
                });
            } else if (msg.document) {
                await bot.sendDocument(userId, msg.document.file_id, {
                    caption: msg.caption || ''
                });
                queueMessage('message', {
                    chatId: ADMIN_ID,
                    text: "✅ Hujjat yuborildi!",
                    options: { reply_to_message_id: replyMsgId }
                });
            } else {
                const text = msg.text?.trim() || '';
                if (text.toLowerCase().startsWith('photo')) {
                    const parts = text.split(/\s+/);
                    if (parts.length >= 2 && isValidUrl(parts[1])) {
                        queueMessage('photo', {
                            chatId: userId,
                            url: parts[1],
                            options: { caption: parts[2] || '' }
                        });
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "✅ Rasm yuborildi!",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    } else {
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "⚠️ Noto'g'ri rasm URL! To'g'ri format: photo <URL> [sarlavha]",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    }
                } else if (text.toLowerCase().startsWith('video')) {
                    const parts = text.split(/\s+/);
                    if (parts.length >= 2 && isValidUrl(parts[1])) {
                        queueMessage('video', {
                            chatId: userId,
                            url: parts[1],
                            options: { caption: parts[2] || '' }
                        });
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "✅ Video yuborildi!",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    } else {
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "⚠️ Noto'g'ri video URL! To'g'ri format: video <URL> [sarlavha]",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    }
                } else if (text.toLowerCase().startsWith('doc')) {
                    const parts = text.split(/\s+/);
                    if (parts.length >= 2 && isValidUrl(parts[1])) {
                        queueMessage('document', {
                            chatId: userId,
                            url: parts[1],
                            options: { caption: parts[2] || '' }
                        });
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "✅ Hujjat yuborildi!",
                            options: { reply_to_message_id: replyMsgId }
                        });
                   

 } else {
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "⚠️ Noto'g'ri hujjat URL! To'g'ri format: doc <URL> [sarlavha]",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    }
                } else if (text.toLowerCase().startsWith('location')) {
                    const parts = text.split(/\s+/);
                    if (parts.length >= 3 && isValidLocation(parseFloat(parts[1]), parseFloat(parts[2]))) {
                        const latitude = parseFloat(parts[1]);
                        const longitude = parseFloat(parts[2]);
                        queueMessage('location', {
                            chatId: userId,
                            latitude,
                            longitude,
                            options: { live_period: 3600 }
                        });
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "✅ Lokatsiya yuborildi!",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    } else {
                        queueMessage('message', {
                            chatId: ADMIN_ID,
                            text: "⚠️ Noto'g'ri lokatsiya kordinatalari! To'g'ri format: location <latitude> <longitude>",
                            options: { reply_to_message_id: replyMsgId }
                        });
                    }
                } else {
                    queueMessage('message', {
                        chatId: userId,
                        text: `📩 ${text}`
                    });
                    queueMessage('message', {
                        chatId: ADMIN_ID,
                        text: "✅ Xabar yuborildi!",
                        options: { reply_to_message_id: replyMsgId }
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error:', error.response?.body || error.message);
        queueMessage('message', {
            chatId: ADMIN_ID,
            text: `⚠️ Xatolik yuz berdi: ${error.response?.body?.description || error.message}`
        });
    }
});

// Keep-alive server for Railway
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Start polling after ensuring no conflicts
bot.stopPolling().then(() => {
    bot.startPolling({ restart: true });
    console.log('Polling started successfully');
}).catch(err => {
    console.error('Error stopping polling:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});
