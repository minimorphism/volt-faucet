// netlify/functions/claim.js

exports.handler = async (event, context) => {
    // Разрешаем CORS (если будут запросы из браузера)
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

        // Проверяем, кто делает запрос: мобильное приложение или обычный юзер (CLI)
        if (authHeader && authHeader === `Bearer ${process.env.MOBILE_APP_AUTH_TOKEN}`) {
            isAppRequest = true;
            type = 'gas_only'; // Мобильному приложению даем только газ для регистрации
        }

        // Если это обычный юзер из CLI, применяем Rate Limiting по IP (1 раз в 24 часа)
        if (!isAppRequest) {
            const userIP = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
            
            // Запрос в Redis
            const redisKey = `faucet:${userIP}`;
            const redisUrl = `${process.env.UPSTASH_REDIS_REST_URL}/get/${redisKey}`;
            
            const redisCheck = await fetch(redisUrl, {
                headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
            });
            const redisData = await redisCheck.json();

            if (redisData.result !== null) {
                return { 
                    statusCode: 429, headers, 
                    body: JSON.stringify({ error: "Rate limit exceeded. You can claim once per 24 hours." }) 
                };
            }

            // Блокируем этот IP на 86400 секунд (24 часа)
            await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${redisKey}/true/EX/86400`, {
                headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
            });
        }

        // Пересылаем команду на ваш защищенный VPS сервер
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

        if (!vpsResponse.ok) {
            return { 
                statusCode: 500, headers, 
                body: JSON.stringify({ error: "Faucet Node Error", details: vpsData.error || vpsData }) 
            };
        }

        // Возвращаем успешный ответ в кошелек или мобильное приложение
        return {
            statusCode: 200,
            headers,
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