const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require("express");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const http = require('http');
const {
    makeWASocket,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    DisconnectReason,
    useMultiFileAuthState,
    Boom
} = require("@whiskeysockets/baileys");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const dotenv = require("dotenv");
const path = require('path');
const cors = require('cors');
const bodyParser = require("body-parser");

dotenv.config();

const allowedGroupJIDs = process.env.GROUP_ID;
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.MODEL });

const store = makeInMemoryStore({ logger: require("pino")().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;
let chatHistory = {};

const port = process.env.PORT || 8000;

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

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
        const { version } = await fetchLatestBaileysVersion();
        sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: require("pino")({ level: "silent" }),
            version,
            shouldIgnoreJid: isJidBroadcast,
        });
        store.bind(sock.ev);
        sock.multi = true;
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = new Boom(lastDisconnect.error).output.statusCode;
                const reconnect = () => connectToWhatsApp();
                const logout = () => sock.logout();
                const actions = {
                    [DisconnectReason.badSession]: () => console.log(`Bad Session File, Please Delete ${session} and Scan Again`),
                    [DisconnectReason.connectionClosed]: reconnect,
                    [DisconnectReason.connectionLost]: reconnect,
                    [DisconnectReason.connectionReplaced]: logout,
                    [DisconnectReason.loggedOut]: logout,
                    [DisconnectReason.restartRequired]: reconnect,
                    [DisconnectReason.timedOut]: reconnect,
                    default: () => sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`)
                };
                (actions[reason] || actions.default)();
            } else if (connection === 'open') {
                console.log('opened connection');
                const groups = Object.values(await sock.groupFetchAllParticipating());
                for (const group of groups) {
                    console.log(`id_group: ${group.id} || Nama Group: ${group.subject}`);
                }
            }
            if (update.qr) {
                qr = update.qr;
                updateQR("qr");
            } else {
                updateQR(update.connection === "open" ? "qrscanned" : "loading");
            }
        });
        sock.ev.on("creds.update", saveCreds);
        sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (type === "notify") {
                const message = messages[0];
                if (!message.key.fromMe) {
                    const sender = message.key.remoteJid;
                    if (!allowedGroupJIDs.includes(sender)) return;
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
                        try {
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
                        } catch (error) {
                            delete chatHistory[sender];
                            await sock.sendMessage(sender, { text: "Maaf, terjadi kesalahan dalam memproses pesan Anda." }, { quoted: message });
                            console.error("Error processing message:", error);
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error connecting to WhatsApp:", error);
        if (soket) {
            soket.emit("log", "Error connecting to WhatsApp. Please check the logs for more details.");
        }
    }
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
    const actions = {
        qr: () => {
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
        },
        connected: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
        },
        qrscanned: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
        },
        loading: () => {
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code, please wait!");
        }
    };
    (actions[data] || (() => {}))();
};

connectToWhatsApp().catch(err => console.log("unexpected error: " + err));

server.listen(port, () => {
    console.log("Server running on port:", port);
});
