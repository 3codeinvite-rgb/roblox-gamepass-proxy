// Proxy Server untuk mengambil gamepass dari Roblox API
// Install dependencies: npm install express axios cors dotenv
// Deploy di Heroku, Railway, atau Render

const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS untuk Roblox
app.use(cors());
app.use(express.json());

// Cache untuk mengurangi API calls
const cache = new Map();
const CACHE_DURATION = 60000; // 1 menit

// Endpoint untuk mendapatkan semua gamepass user
app.get('/api/user/:userId/gamepasses', async (req, res) => {
    const userId = req.params.userId;
    const cacheKey = `gamepasses_${userId}`;
    
    // Check cache
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            return res.json(cached.data);
        }
    }
    
    try {
        const gamepasses = [];
        let cursor = '';
        let hasMore = true;
        
        // Loop untuk mendapatkan semua gamepass (pagination)
        while (hasMore) {
            const url = `https://games.roblox.com/v1/games/multiget-place-details?placeIds=&cursor=${cursor}`;
            const passesUrl = `https://www.roblox.com/users/inventory/list-json?assetTypeId=34&cursor=${cursor}&itemsPerPage=100&pageNumber=1&userId=${userId}`;
            
            // Get user's created gamepasses
            const createdPassesResponse = await axios.get(
                `https://apis.roblox.com/game-passes/v1/game-passes?creatorId=${userId}&creatorType=User&limit=100&cursor=${cursor}`
            );
            
            if (createdPassesResponse.data && createdPassesResponse.data.data) {
                for (const pass of createdPassesResponse.data.data) {
                    gamepasses.push({
                        id: pass.id,
                        name: pass.name,
                        displayName: pass.displayName || pass.name,
                        price: pass.price || 0,
                        description: pass.description || '',
                        iconImageId: pass.iconImageId,
                        isForSale: pass.isForSale !== false,
                        sellerId: userId,
                        sellerName: pass.sellerName || 'Unknown',
                        productId: pass.productId
                    });
                }
                
                cursor = createdPassesResponse.data.nextPageCursor || '';
                hasMore = !!cursor;
            } else {
                hasMore = false;
            }
        }
        
        // Also get gamepasses from user's games
        const userGamesResponse = await axios.get(
            `https://games.roblox.com/v2/users/${userId}/games?limit=50&sortOrder=Asc`
        );
        
        if (userGamesResponse.data && userGamesResponse.data.data) {
            for (const game of userGamesResponse.data.data) {
                try {
                    const gamePassesResponse = await axios.get(
                        `https://games.roblox.com/v1/games/${game.rootPlaceId}/game-passes?limit=100&sortOrder=Asc`
                    );
                    
                    if (gamePassesResponse.data && gamePassesResponse.data.data) {
                        for (const pass of gamePassesResponse.data.data) {
                            // Avoid duplicates
                            if (!gamepasses.find(p => p.id === pass.id)) {
                                gamepasses.push({
                                    id: pass.id,
                                    name: pass.name,
                                    displayName: pass.displayName || pass.name,
                                    price: pass.price || 0,
                                    description: pass.description || '',
                                    iconImageId: pass.iconImageId,
                                    isForSale: pass.isForSale !== false,
                                    sellerId: userId,
                                    sellerName: pass.sellerName || 'Unknown',
                                    productId: pass.productId,
                                    gameId: game.id,
                                    gameName: game.name
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error fetching passes for game ${game.id}:`, err.message);
                }
            }
        }
        
        // Sort by price
        gamepasses.sort((a, b) => a.price - b.price);
        
        // Cache the result
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: { success: true, gamepasses }
        });
        
        res.json({ success: true, gamepasses });
        
    } catch (error) {
        console.error('Error fetching gamepasses:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch gamepasses',
            message: error.message 
        });
    }
});

// Endpoint untuk mendapatkan info single gamepass
app.get('/api/gamepass/:gamepassId', async (req, res) => {
    const gamepassId = req.params.gamepassId;
    
    try {
        const response = await axios.get(
            `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`
        );
        
        res.json({ 
            success: true, 
            gamepass: response.data 
        });
        
    } catch (error) {
        console.error('Error fetching gamepass info:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch gamepass info' 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: Date.now() });
});

// Clear cache endpoint
app.post('/api/cache/clear', (req, res) => {
    cache.clear();
    res.json({ success: true, message: 'Cache cleared' });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});