const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");
require('dotenv').config(); 
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { Boom } = require("@hapi/boom");
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const http = require("http");
const path = require('path');
const qrcode = require("qrcode");
const pino = require("pino");

const session = "baileys_auth_info";
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

// Configuration for message generation
const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048
};

// Safety settings for model response
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// History for the model response
let chatHistory = [
    { role: "user", parts: [{ text: "Kamu adalah Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
    { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
];

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload({ createParentPath: true }));
app.use("/assets", express.static(path.join(__dirname, "client", "assets")));

app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
let sock;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(session);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: isJidBroadcast,
    });
    store.bind(sock.ev);
    sock.multi = true;
    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", handleMessagesUpsert);
}

function handleConnectionUpdate(update) {
    const { connection, lastDisconnect } = update;
    switch (connection) {
        case 'close':
            handleConnectionClose(lastDisconnect.error);
            break;
        case 'open':
            console.log('Opened connection');
            break;
        default:
            break;
    }
    if (update.qr) {
        qr = update.qr;
        updateQR("qr");
    } else if (!qr) {
        updateQR("loading");
    } else if (update.connection === "open") {
        updateQR("qrscanned");
    }
}

async function handleMessagesUpsert({ messages, type }) {
    if (type === "notify" && !messages[0].key.fromMe) {
        let pesan = messages[0].message.conversation || messages[0].message.extendedTextMessage?.text;
        const noWa = messages[0].key.remoteJid;

        if (!pesan) return;

        try {
            await sock.readMessages([messages[0].key]);
            await sock.sendPresenceUpdate('composing', noWa);
            const response = await handleMessage(pesan);
            await sock.sendMessage(noWa, { text: response }, { quoted: messages[0] });
        } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(noWa, { text: `Error: ${error.message}` }, { quoted: messages[0] });
        }
    }
}

async function handleMessage(pesan) {
    const chat = model.startChat({
        generationConfig,
        safetySettings,
        history: chatHistory,
    });

    const result = await chat.sendMessage(pesan);
    const response = await result.response;
    const text = response.text();
    console.log(text);
    return text;
}

function handleConnectionClose(error) {
    const reason = new Boom(error).output.statusCode;
    switch (reason) {
        case DisconnectReason.badSession:
            console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
            sock.logout();
            break;
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.restartRequired:
        case DisconnectReason.timedOut:
            console.log("Reconnecting...");
            connectToWhatsApp();
            break;
        case DisconnectReason.connectionReplaced:
        case DisconnectReason.loggedOut:
            console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
            sock.logout();
            break;
        default:
            sock.end(`Unknown DisconnectReason: ${reason}|${error}`);
            break;
    }
}

function isConnected() {
    return !!sock.user;
}

function updateQR(status) {
    const statusMap = {
        "qr": () => {
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
        },
        "connected": () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
        },
        "qrscanned": () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
        },
        "loading": () => {
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
        },
    };
    const updateFunction = statusMap[status];
    if (updateFunction) updateFunction();
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }

    socket.on("sendMessage", async (message) => {
        console.log("Message received from client:", message);

        try {
            const response = await handleMessage(message);
            soket.emit("messageResponse", response);
        } catch (error) {
            console.error('Error:', error);
            soket.emit("messageResponse", { error: error.message });
        }
    });
});

connectToWhatsApp().catch(err => console.log("Unexpected error: " + err));
server.listen(port, () => {
    console.log("Server running on port: " + port);
});
