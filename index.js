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
    temperature: process.env.TEMPERATURE,
    topP: process.env.TOP_P,
    topK: process.env.TOP_K,
    maxOutputTokens: process.env.MAX_TOKEN,
};

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;
let chatHistory = {};

const allowedGroupJIDs = process.env.GROUP_ID;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    let { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    store.bind(sock.ev);
    sock.multi = true;
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
                sock.logout();
            } else {
                console.log("Unhandled Disconnect Reason: ", reason);
                sock.logout();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            let groups = Object.values(await sock.groupFetchAllParticipating());
            for (let group of groups) {
                console.log("id_group: " + group.id + " || Nama Group: " + group.subject);
            }
            return;
        }
        if (update.qr) {
            qr = update.qr;
            updateQR("qr");
        } else if (qr === undefined) {
            updateQR("loading");
        } else {
            if (update.connection === "open") {
                updateQR("qrscanned");
                return;
            }
        }
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "notify") {
            if (!messages[0].key.fromMe) {
                const message = messages[0];
                const sender = message.key.remoteJid;

                // Check if the message is from an allowed group
                if (!allowedGroupJIDs.includes(sender)) {
                    return;
                }

                const messageContent = message.message.conversation || (message.message.extendedTextMessage && message.message.extendedTextMessage.text);
                if (!messageContent) return;
                const incomingMessage = messageContent.toLowerCase();
                const formattedSender = `+${sender.match(/\d+/)[0]}`;

                await sock.readMessages([message.key]);
                await sock.sendPresenceUpdate("composing", sender);

                if (!messages[0].key.fromMe && incomingMessage === "/new") {
                    await sock.sendMessage(sender, { text: `Conversation ID: ${formattedSender}` }, { quoted: message });
                } else {
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
                        await sock.sendMessage(sender, { text: "Maaf, terjadi kesalahan. Silakan coba lagi." }, { quoted: message });
                        delete chatHistory[sender];
                    } else {
                        console.log(JSON.stringify(chatHistory[sender]));
                        await sock.sendMessage(sender, { text: response }, { quoted: message });
                    }
                }
            }
        }
    });
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

const isConnected = () => {
    return (sock.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

connectToWhatsApp()
    .catch(err => console.log("unexpected error: " + err))
server.listen(port, () => {
    console.log("Server running on port:", port);
});
