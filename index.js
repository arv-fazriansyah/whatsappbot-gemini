const express = require("express");
const http = require("http");
const path = require("path");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const dotenv = require("dotenv");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const {
    makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;

app.use(fileUpload({ createParentPath: true }));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/assets", express.static(path.join(__dirname, "client", "assets")));
app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

const generationConfig = {
    temperature: 0.9,
    topP: 0.1,
    topK: 16,
    maxOutputTokens: 2048,
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

let chatHistory = {};

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: "silent" }),
            version,
            shouldIgnoreJid: isJidBroadcast,
        });

        store.bind(sock.ev);

        sock.ev.on("connection.update", handleConnectionUpdate);
        sock.ev.on("creds.update", saveCreds);
        sock.ev.on("messages.upsert", handleMessageUpsert);
    } catch (error) {
        console.error("Unexpected error: ", error);
        clearHistoryAndReconnect();
    }
}

function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr: qrCode } = update;

    if (connection === "close") {
        const reason = new Boom(lastDisconnect?.error).output.statusCode;
        handleDisconnect(reason, lastDisconnect);
    } else if (connection === "open") {
        console.log("Opened connection");
    }

    if (qrCode) {
        qr = qrCode;
        updateQR("qr");
    } else if (qr === undefined) {
        updateQR("loading");
    } else if (connection === "open") {
        updateQR("qrscanned");
    }
}

function handleDisconnect(reason, lastDisconnect) {
    switch (reason) {
        case DisconnectReason.badSession:
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.connectionReplaced:
        case DisconnectReason.loggedOut:
        case DisconnectReason.restartRequired:
        case DisconnectReason.timedOut:
            console.log(`Reconnecting due to: ${reason}`);
            clearHistoryAndReconnect();
            break;
        default:
            console.log(`Unknown DisconnectReason: ${reason}|${lastDisconnect?.error}`);
            clearHistoryAndReconnect();
    }
}

function clearHistoryAndReconnect() {
    chatHistory = {};
    connectToWhatsApp();
}

async function handleMessageUpsert({ messages, type }) {
    if (type === "notify" && messages.length > 0 && !messages[0].key.fromMe) {
        const message = messages[0];
        const messageContent = message.message.conversation || (message.message.extendedTextMessage && message.message.extendedTextMessage.text);

        if (!messageContent) return;

        const incomingMessage = messageContent.toLowerCase();
        const sender = message.key.remoteJid;
        const formattedSender = sender.match(/\d+/)[0];
        const formattedSenderWithPlus = `+${formattedSender}`;

        try {
            await sock.readMessages([message.key]);
            await sock.sendPresenceUpdate("composing", sender);

            if (incomingMessage === "/new") {
                delete chatHistory[sender];
                await sendWhatsAppMessage(sender, `Conversation ID: ${formattedSenderWithPlus}`, message);
                return;
            }

            const response = await generateResponse(incomingMessage, sender, message);
            if (response === "") {
                delete chatHistory[sender];
                await sendWhatsAppMessage(sender, "Pesan tidak dapat diproses.", message);
            } else {
                await sendWhatsAppMessage(sender, response, message);
            }
        } catch (error) {
            console.error("Error:", error);
            await sendWhatsAppMessage(sender, "Server bermasalah. Silahkan coba lagi nanti.", message);
        }
    }
}

async function generateResponse(incomingMessage, sender, message) { 
    if (!chatHistory[sender]) {
        chatHistory[sender] = [
            { role: "user", parts: [{ text: `Halo, nama saya: ${message.pushName}` }] }, 
            { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
        ];
    }

    const chat = model.startChat({
        generationConfig,
        safetySettings,
        history: chatHistory[sender],
    });

    const result = await chat.sendMessage(incomingMessage);
    const response = await result.response;
    const text = response.text();

    return text;
}

async function sendWhatsAppMessage(recipient, text, quotedMessage) {
    await sock.sendMessage(recipient, { text }, { quoted: quotedMessage });
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

const isConnected = () => !!sock?.user;

const updateQR = (data) => {
    const status = {
        qr: async () => {
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
        },
        connected: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp connected!");
        },
        qrscanned: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code has been scanned!");
        },
        loading: () => {
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code, please wait!");
        },
    };

    if (status[data]) status[data]();
};

connectToWhatsApp();

server.listen(port, () => {
    console.log("Server running on port:" + port);
});

