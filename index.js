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
const { GoogleGenerativeAI } = require("@google/generative-ai");
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
        console.error("Unexpected error:", error);
        clearHistoryAndReconnect();
    }
}

function handleConnectionUpdate({ connection, lastDisconnect, qr: qrCode }) {
    if (connection === "close") {
        handleDisconnect(new Boom(lastDisconnect?.error).output.statusCode);
    } else if (connection === "open") {
        console.log("Opened connection");
    }

    qr = qrCode || qr;
    updateQR(connection === "open" ? "qrscanned" : qr ? "qr" : "loading");
}

function handleDisconnect(reason) {
    console.log(`Connection closed, reason: ${DisconnectReason[reason] || reason}`);
    clearHistoryAndReconnect();
}

function clearHistoryAndReconnect() {
    chatHistory = {};
    connectToWhatsApp();
}

async function handleMessageUpsert({ messages, type }) {
    if (type !== "notify" || messages.length === 0 || messages[0].key.fromMe) return;

    const message = messages[0];
    const messageContent = message.message.conversation || (message.message.extendedTextMessage && message.message.extendedTextMessage.text);
    if (!messageContent) return;

    const incomingMessage = messageContent.toLowerCase();
    const sender = message.key.remoteJid;
    const formattedSender = `+${sender.match(/\d+/)[0]}`;

    try {
        await sock.readMessages([message.key]);
        await sock.sendPresenceUpdate("composing", sender);

        if (incomingMessage === "/new") {
            delete chatHistory[sender];
            await sock.sendMessage(sender, { text: `Conversation ID: ${formattedSender}` }, { quoted: message });
            return;
        }

        if (!chatHistory[sender]) {
            chatHistory[sender] = [
                { role: "user", parts: [{ text: `Halo, nama saya: ${message.pushName}` }] },
                { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
            ];
        }

        const chat = model.startChat({ generationConfig, history: chatHistory[sender] });
        const result = await chat.sendMessage(incomingMessage);
        const response = (await result.response).text().replace(/\*\*/g, '*');

        if (!response) {
            throw new Error("Empty response");
        } else {
            await sock.sendMessage(sender, { text: response }, { quoted: message });
        }
    } catch (error) {
        console.error(error);
        delete chatHistory[sender];
        await sock.sendMessage(sender, { text: "Server bermasalah. Silahkan coba lagi nanti." }, { quoted: message });
    }
}

io.on("connection", (socket) => {
    soket = socket;
    updateQR(isConnected() ? "connected" : qr ? "qr" : "loading");
});

const isConnected = () => !!sock?.user;

const updateQR = (status) => {
    const statusActions = {
        qr: () => qrcode.toDataURL(qr, (err, url) => {
            if (err) return console.error(err);
            soket?.emit("qr", url);
            soket?.emit("log", "QR Code received, please scan!");
        }),
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

    if (statusActions[status]) statusActions[status]();
};

connectToWhatsApp().catch((error) => console.error("Failed to connect to WhatsApp:", error));

server.listen(port, () => {
    console.log("Server running on port:", port);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
