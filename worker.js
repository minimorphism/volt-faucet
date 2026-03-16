require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Секретный ключ, который должны знать только Netlify и этот Worker (задайте в .env)
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "SUPER_SECRET_KEY_123";

// Лимиты выдачи
const AMOUNTS = {
    testnet: process.env.FAUCET_TESTNET_AMOUNT || "10.0",
    gas_only: process.env.FAUCET_GAS_AMOUNT || "0.05" // Выдача фракционов для регистрации username
};

app.post('/internal-send', (req, res) => {
    const { address, network, secret, type } = req.body;

    if (secret !== INTERNAL_API_SECRET) {
        return res.status(403).json({ error: "Unauthorized access" });
    }

    // Защита от Command Injection
    if (!address || !/^[a-zA-Z0-9x_]+$/.test(address)) {
        return res.status(400).json({ error: "Invalid address format" });
    }

    const amount = type === 'gas_only' ? AMOUNTS.gas_only : AMOUNTS.testnet;
    console.log(`[FAUCET] Command received: Send ${amount} VOLT to ${address} on ${network}`);

    // Путь к вашему бинарнику
    const walletPath = "/usr/local/bin/volt-wallet"; 
    
    // ВАЖНО: Используем флаг --yes, чтобы скрипт не завис!
    const cmd = `${walletPath} --send --amount ${amount} --to ${address} --yes`;

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`[EXEC ERROR]: ${error.message}`);
            return res.status(500).json({ error: "Node/Wallet failed to broadcast tx", details: stderr });
        }

        // Парсим вывод в поиске хэша
        const match = stdout.match(/TX Hash:\s([a-fA-F0-9]+)/);
        const txHash = match ? match[1] : "Hash not found in output";

        console.log(`[SUCCESS] TX: ${txHash}`);
        res.json({ success: true, amount, txHash });
    });
});

const PORT = 4000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`VPS Worker running on port ${PORT}`);
});