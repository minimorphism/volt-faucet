// netlify/functions/claim.js

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

    try {
        const body = JSON.parse(event.body);
        const { address, network } = body;

        if (!address) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Address is required" }) };
        }

        const authHeader = event.headers.authorization;
        let isAppRequest = false;
        let type = 'testnet';

        if (authHeader && authHeader === `Bearer ${process.env.MOBILE_APP_AUTH_TOKEN}`) {
            isAppRequest = true;
            type = 'gas_only';
        }

        const userIP = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
        const redisKey = `faucet:${userIP}`;

        // ПРОВЕРКА REDIS (До отправки на VPS)
        if (!isAppRequest) {
            const redisUrl = `${process.env.UPSTASH_REDIS_REST_URL}/get/${redisKey}`;
            const redisCheck = await fetch(redisUrl, {
                headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
            });
            const redisData = await redisCheck.json();

            if (redisData.result !== null) {
                return { 
                    statusCode: 429, headers, 
                    body: JSON.stringify({ error: "Rate limit exceeded. You can claim once per 10 minutes." }) 
                };
            }
        }

        // ОТПРАВКА НА VPS
        const vpsResponse = await fetch(process.env.VPS_FAUCET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address: address,
                network: network || 'devnet',
                secret: process.env.VPS_API_SECRET,
                type: type
            })
        });

        const vpsData = await vpsResponse.json();

        // ЕСЛИ VPS ВЫДАЛ ОШИБКУ — ВОЗВРАЩАЕМ ЕЁ (без блокировки в Redis)
        if (!vpsResponse.ok) {
            return { 
                statusCode: 500, headers, 
                body: JSON.stringify({ error: "Faucet Node Error", details: vpsData.error || vpsData }) 
            };
        }

        // ЕСЛИ ТРАНЗАКЦИЯ УСПЕШНА — БЛОКИРУЕМ В REDIS НА 600 СЕКУНД (10 МИНУТ)
        if (!isAppRequest) {
            await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${redisKey}/true/EX/600`, {
                headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
            });
        }

        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                status: "Success",
                message: isAppRequest ? "Gas provisioned for app." : "Funds sent!",
                amount_sent: vpsData.amount,
                txHash: vpsData.txHash
            })
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal Error", details: error.message }) };
    }
};