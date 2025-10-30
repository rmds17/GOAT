// const express = require('express');
// const app = express();

// app.use(express.json());
// app.use((req, res, next) => {
//     const start = Date.now();

//     res.on('finish', () => {
//         const duration = Date.now() - start;
//         console.log(`${req.method} ${req.url} - ${duration}ms`);
//     });

//     next();
// });

// app.get('/', (req, res) => {
//     res.send('Hello World!');
// });

// app.get('/health', (req, res) => {
//     res.json({ status: 'active', timestamp: new Date().toISOString() });
// });

// app.get('/time', (req, res) => {
//     res.send(new Date().toISOString());
// });

// app.get('/echo', (req, res) => {
//     const { category, color } = req.query;
//     if (!category && !color) {
//         throw new Error('category or color are required');
//     } else {
//         res.json({ ok: true, category: category, color: color });
//     }
// });

// app.get('/error-route', (req, res) => {
//     throw new Error('Something went wrong!');
// });

// async function fetchPost(userId, limit) {
//     try {
//         const response = await fetch(`https://jsonplaceholder.typicode.com/posts?userId=${userId}&_limit=${limit}`);
//         const data = await response.json();
//         return data;
//     } catch (error) {
//         throw new Error('Failed to fetch posts');
//     }
// }

// app.get('/external', async (req, res) => {
//     const { userId = 1, limit = 5 } = req.query;

//     const posts = await fetchPost(userId, limit);
//     res.json({ ok: true, data: posts, params: { userId, limit } });
// });

// // Global Error Middleware
// app.use((err, req, res, next) => {
//     res.status(500).json({
//         ok: false,
//         error: err.message || 'Internal server error',
//     });
// });


// module.exports = app;
