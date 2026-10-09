const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const express = require('express');

// Express server setup for Render port binding & 24/7 uptime
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Rajeshwari Nutrition Center WhatsApp Bot is Running Live!');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// பயனர்களின் முன்பதிவு நிலை மற்றும் மொழி விருப்பத்தை (Language Session) சேமிக்க
const userSessions = {};

// 🔴 அட்மின் வாட்ஸ்அப் நம்பர் (7200537033)
const ADMIN_PHONE = '917200537033@s.whatsapp.net';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('SCAN THIS QR CODE TO LOGIN:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot is ready and instantly responding!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];

        let userMessage = '';
        if (messageType === 'conversation') {
            userMessage = msg.message.conversation;
        } else if (messageType === 'extendedTextMessage') {
            userMessage = msg.message.extendedTextMessage.text;
        }

        const text = userMessage.trim();
        const lowerText = text.toLowerCase();

        // புதிய பயனராக இருந்தால் மொழியைக் கண்டறிந்து செஷன் தொடங்குதல்
        if (!userSessions[chatId]) {
            const isTamilInput = /[\u0B80-\u0BFF]/.test(text) || lowerText.includes('வணக்கம்') || lowerText.includes('சேவைகள்') || lowerText.includes('ஊட்டச்சத்து');
            userSessions[chatId] = {
                language: isTamilInput ? 'ta' : 'en',
                step: null
            };
        }

        const currentLang = userSessions[chatId].language;

        // 1. முன்பதிவு நிலை நடந்து கொண்டிருந்தால் அதை நிர்வகித்தல்
        if (userSessions[chatId].step) {
            const currentState = userSessions[chatId].step;

            if (currentState === 'WAITING_FOR_NAME') {
                userSessions[chatId].name = text;
                userSessions[chatId].step = 'WAITING_FOR_TIME';

                const promptTimeText = (currentLang === 'ta') ?
                    `மிகவும் நன்றி, *${text}*! 🌟\n\nநீங்கள் எந்த தேதியில் மற்றும் எந்த நேரத்தில் உடல் கட்டமைப்பு பரிசோதனைக்கு வர விரும்புகிறீர்கள்? (உதாரணமாக: நாளை காலை 8:30 மணி) நேரத்தைத் பதிவிடவும்:` :
                    `Thank you so much, *${text}*! 🌟\n\nAt what date and time would you like to visit for your Body Composition Analysis? (e.g., Tomorrow 8:30 AM) Please provide the time slot:`;

                await sock.sendMessage(chatId, { text: promptTimeText });
                return;
            }
            else if (currentState === 'WAITING_FOR_TIME') {
                const userName = userSessions[chatId].name;
                const appointmentTime = text;
                const userPhone = chatId.split('@')[0];

                // வாடிக்கையாளருக்கு உறுதிப்படுத்தல் செய்தி (Success Message)
                const successText = (currentLang === 'ta') ?
                    `🎉 *வாழ்த்துகள்! உங்களது உடல் பரிசோதனை முன்பதிவு வெற்றிகரமாக உறுதி செய்யப்பட்டது!* 🎉\n\n👤 **பெயர்:** ${userName}\n⏰ **நேரம்:** ${appointmentTime}\n📍 **இடம்:** ராஜேஷ்வரி நியூட்ரிஷன் சென்டர், சேலம் மெயின் ரோடு அருகில், கள்ளக்குறிச்சி.\n\nஉங்களின் ஆரோக்கிய பயணத்தில் உங்களைச் சந்திப்பதில் பெருமகிழ்ச்சி அடைகிறோம்!` :
                    `🎉 *Congratulations! Your Appointment is Successfully Confirmed!* 🎉\n\n👤 **Name:** ${userName}\n⏰ **Time Slot:** ${appointmentTime}\n📍 **Location:** Rajeshwari Nutrition Center, Near Salem Main Road, Kallakurichi.\n\nWe are excited to welcome you on your wellness journey!`;

                await sock.sendMessage(chatId, { text: successText });

                // 🔴 அட்மினுக்கு (7200537033) முன்பதிவு விவரங்களை உடனடியாக அனுப்புதல்
                const adminAlertText = `🔔 *புதிய உடல் பரிசோதனை முன்பதிவு வந்துள்ளது!* 🔔\n\n👤 **வாடிக்கையாளர் பெயர்:** ${userName}\n📞 **போன் நம்பர்:** +${userPhone}\n⏰ **குறிக்கப்பட்ட நேரம்:** ${appointmentTime}\n\nதயவுசெய்து கவனிக்கவும்!`;
                await sock.sendMessage(ADMIN_PHONE, { text: adminAlertText });

                // நிலையை மீட்டமைத்தல் (Reset Step)
                userSessions[chatId].step = null;
                delete userSessions[chatId].name;
                return;
            }
        }

        // 2. முன்பதிவு தொடங்குவதற்கான தூண்டுதல் (Trigger - Option 5)
        if (lowerText.includes('appointment') || lowerText.includes('book') || lowerText.includes('பரிசோதனை') || lowerText.includes('முன்பதிவு') || lowerText === '5') {
            userSessions[chatId].step = 'WAITING_FOR_NAME';
            const bookPrompt = (currentLang === 'ta') ?
                `🌿 *இலவச உடல் கட்டமைப்பு பரிசோதனை முன்பதிவு* 🌿\n\nஉங்கள் உடல் எடையைக் துல்லியமாகக் கண்காணிக்க எங்களது மையத்திற்கு உங்களை வரவேற்கிறோம்!\n\nதயவுசெய்து உங்களது **முழுப் பெயரை (Full Name)** இங்கே பதிவிடவும்:` :
                `🌿 *Free Body Composition Analysis Booking* 🌿\n\nWe welcome you to accurately monitor your health and fitness goals!\n\nKindly enter your **Full Name** below to proceed:`;

            await sock.sendMessage(chatId, { text: bookPrompt });
            return;
        }

        // Helper function for sending images with instant captions
        async function sendMediaMessage(subFolder, imageName, captionText) {
            try {
                const imagePath = path.join(__dirname, 'images', subFolder, imageName);
                if (fs.existsSync(imagePath)) {
                    const buffer = fs.readFileSync(imagePath);
                    await sock.sendMessage(chatId, { image: buffer, caption: captionText });
                } else {
                    await sock.sendMessage(chatId, { text: captionText });
                }
            } catch (err) {
                await sock.sendMessage(chatId, { text: captionText });
            }
        }

        // 3. Welcome Message (Unique & Language Based)
        if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'menu' || lowerText === 'start' || lowerText === 'வணக்கம்' || lowerText === 'vanakkam') {
            const isTamilInput = /[\u0B80-\u0BFF]/.test(text) || lowerText.includes('வணக்கம்');
            userSessions[chatId].language = isTamilInput ? 'ta' : 'en';
            const lang = userSessions[chatId].language;

            const welcomeText = (lang === 'ta') ?
                `✨🌿 **ராஜேஷ்வரி நியூட்ரிஷன் சென்டருக்கு உங்களை அன்புடன் வரவேற்கிறோம்!** 🌿✨\n\nகள்ளக்குறிச்சியின் நம்பகமான ஆரோக்கிய மற்றும் உடற்பயிற்சி மையம். உங்களின் கனவு உடல் எடையை அடையவும், முழுமையான ஆரோக்கியத்தைப் பெறவும் நாங்கள் உங்களுக்குத் துணையாய் இருக்கிறோம்.\n\n🎯 **இன்று உங்களுக்கு எந்த சேவையில் வழிகாட்ட வேண்டும்? கீழே உள்ளவற்றில் ஒன்றைத் தேர்ந்தெடுக்கவும்:**\n\n🌱 **1. Services** (எங்கள் சேவைகள்)\n🥗 **2. Nutrition Programs** (ஊட்டச்சத்து திட்டங்கள்)\n⚖️ **3. Weight Management** (எடை மேலாண்மை)\n💪 **4. Fitness & Lifestyle** (உடற்பயிற்சி & வாழ்க்கை முறை)\n📅 **5. Appointment / முன்பதிவு** (இலவச உடல் பரிசோதனை)\n📍 **6. Address** (மையத்தின் முகவரி)\n📞 **7. Contact** (தொடர்புக்கு)\n\n*(உங்களுக்குத் தேவையான விருப்பத்தை அல்லது அதன் எண்ணைத் கீழே டைப் செய்யவும்)*` :

                `✨🌿 **Welcome to Rajeshwari Nutrition Center!** 🌿✨\n\nKallakurichi's premier destination for complete wellness, vitality, and body transformation. We empower you to achieve sustainable health and peak physical fitness.\n\n🎯 **How can we elevate your wellness journey today? Choose an option below:**\n\n🌱 **1. Services**\n🥗 **2. Nutrition Programs**\n⚖️ **3. Weight Management**\n💪 **4. Fitness & Lifestyle**\n📅 **5. Appointment / Booking**\n📍 **6. Address**\n📞 **7. Contact Coach**\n\n*(Simply type your choice or the option number to explore)*`;

            await sendMediaMessage('welcome', 'Welcome.png', welcomeText);
            return;
        }

        // 4. Core Features (Strictly based on session language)
        if (lowerText.includes('services') || lowerText.includes('சேவைகள்') || lowerText === '1') {
            const serviceText = (currentLang === 'ta') ?
                `🌱 **எங்கள் முதன்மைச் சேவைகள்** 🌱\n\nஹெர்பலைஃப் நியூட்ரிஷன் மூலம் உங்களின் ஆரோக்கிய இலக்குகளை எட்ட நாங்கள் வழங்கும் பிரத்யேக சேவைகள்:\n• தனிப்பயனாக்கப்பட்ட உடல் எடை குறைப்பு திட்டங்கள்\n• ஆரோக்கியமான உடல் எடை மற்றும் தசை அதிகரிப்பு\n• காலை நேர சமூக உடற்பயிற்சி வகுப்புகள்\n• நவீன உடல் கட்டமைப்பு (Metabolic) பரிசோதனை` :

                `🌱 **Our Core Professional Services** 🌱\n\nPowered by Herbalife Nutrition, we provide comprehensive health solutions tailored to your unique body type:\n• Personalized Fat Loss & Transformation Programs\n• Healthy Weight Gain & Muscle Building\n• Energetic Morning Community Fitness Sessions\n• Advanced Metabolic Body Composition Monitoring`;

            await sendMediaMessage('service', 'service.png', serviceText);
        }
        else if (lowerText.includes('nutrition') || lowerText.includes('ஊட்டச்சத்து') || lowerText === '2') {
            const programText = (currentLang === 'ta') ?
                `🥗 **ஊட்டச்சத்து மற்றும் உணவுத் திட்டங்கள்** 🥗\n\n*"உணவே மருந்து, மருந்தே உணவு"* - எங்களது பொன்மொழி.\n\nஉங்கள் உடலுக்குத் தேவையான சரியான சத்துக்களை வழங்கி, எனர்ஜியுடன் இருக்கச் செய்யும் பிரத்யேக உணவு மாற்றீட்டுத் திட்டங்கள் மற்றும் தனித்துவமான ஊட்டச்சத்து வழிகாட்டுதல் இங்கே வழங்கப்படுகிறது.` :

                `🥗 **Specialized Nutrition Programs** 🥗\n\n*Motto: "Food is medicine, medicine is food."*\n\nAchieve optimal nourishment with our scientifically designed meal replacement plans, customized macro-tracking, and expert nutritional counseling for long-term vitality.`;

            await sendMediaMessage('program', 'program.png', programText);
        }
        else if (lowerText.includes('weight') || lowerText.includes('எடை') || lowerText === '3') {
            const weightText = (currentLang === 'ta') ?
                `⚖️ **ശാസ്ത്രபூர்வமான எடை மேலாண்மை** ⚖️\n\nபயனில்லாத டயட்டுகளால் சோர்வடைந்துவிட்டீர்களா? எங்களது ஆரோக்கியமான மற்றும் பாதுகாப்பான எடை மேலாண்மை முறை மூலம்:\n• பக்கவிளைவுகள் இல்லாத கொழுப்பு குறைப்பு\n• ஆரோக்கியமான முறையில் எடையைக் கூட்டுதல்\n• எனர்ஜி குறையாமல் உடலைப் பராமரித்தல்` :

                `⚖️ **Advanced Weight Management** ⚖️\n\nTransform your body safely and sustainably with our structured guidance:\n• Targeted, steady, and healthy fat reduction routines\n• Lean muscle mass development and healthy weight gain\n• Continuous metabolic tracking for lasting results`;

            await sendMediaMessage('weight', 'weight.png', weightText);
        }
        else if (lowerText.includes('fitness') || lowerText.includes('உடற்பயிற்சி') || lowerText === '4') {
            const fitnessText = (currentLang === 'ta') ?
                `💪 **உடற்பயிற்சி & வாழ்க்கை முறை** 💪\n\nஉடற்பயிற்சி என்பது ஒரு வேலை அல்ல, அது ஒரு சிறந்த வாழ்க்கை முறை!\n• சுறுசுறுப்பான காலை நேர ஆன்லைன் & ஆஃப்லைன் உடற்பயிற்சி சந்திப்புகள்\n• சீரான வாழ்க்கை முறை பழக்கவழக்கங்கள் மற்றும் குழு ஊக்கம்.` :

                `💪 **Fitness & Lifestyle Principles** 💪\n\nTrue fitness is a lifestyle, not a chore. We focus on holistic daily habits:\n• Engaging morning community workout meetups and high-energy group motivation\n• Sustainable active lifestyle coaching and daily routine optimization.`;

            await sendMediaMessage('fitness', 'principle.png', fitnessText);
        }
        else if (lowerText.includes('address') || lowerText.includes('முகவரி') || lowerText === '6') {
            const addressText = (currentLang === 'ta') ?
                `📍 **எங்கள் மையத்தின் முகவரி & நேரம்** 📍\n\nஹெர்பலைஃப் நியூட்ரிஷன் சென்டர்,\n2A, கந்தபொடி சந்து,\nOTTO துணிக்கடை & HDFC பேங்க் எதிரில்,\nசேலம் மெயின் ரோடு அருகில்,\nகள்ளக்குறிச்சி - 606202.\n\n⏰ **நேரம்:** திங்கள் முதல் ஞாயிறு வரை, காலை 7:30 மணி முதல் 10:30 மணி வரை.` :

                `📍 **Our Center Address & Timings** 📍\n\nHerbalife Nutrition Center,\n2A, Kanthapodi Lane,\nOpposite OTTO Clothing & HDFC Bank,\nNear Salem Main Road,\nKallakurichi, Tamil Nadu - 606202.\n\n⏰ **Timings:** Monday to Sunday, 7:30 AM – 10:30 AM.`;

            await sock.sendMessage(chatId, { text: addressText });
        }
        else if (lowerText.includes('contact') || lowerText.includes('தொடர்பு') || lowerText === '7') {
            const contactText = (currentLang === 'ta') ?
                `📞 **கோச்சைத் தொடர்புகொள்ள** 📞\n\nசுதந்திரமான வெல்னெஸ் கோச் எஸ். ராஜேஷ்வரியை நேரடியாகத் தொடர்பு கொண்டு உங்களது ஆரோக்கிய சந்தேகங்களைக் கேட்கலாம்:\n\n📱 **போன் நம்பர்:** +91 97871 05903 / +91 63839 96873` :

                `📞 **Contact Our Wellness Coach** 📞\n\nConnect directly with Independent Wellness Coach S. Rajeshwari for personalized health consultations:\n\n📱 **Phone:** +91 97871 05903 / +91 63839 96873`;

            await sock.sendMessage(chatId, { text: contactText });
        }
        else {
            // 5. Fallback Message (Language Specific)
            const fallbackText = (currentLang === 'ta') ?
                `மன்னிக்கவும், எனக்கு அது புரியவில்லை. மீண்டும் மெனுவைக் காண **'Hi'** அல்லது **'Menu'** என அனுப்பவும்.` :
                `I'm sorry, I didn't understand that. To view the main menu again, please send **'Hi'** or **'Menu'**.`;

            await sock.sendMessage(chatId, { text: fallbackText });
        }
    });
}

connectToWhatsApp();