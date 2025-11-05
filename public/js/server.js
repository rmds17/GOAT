// // const express = require('express');
// // const app = express();
// // const PORT = process.env.PORT || 3000;

// // app.get('/', (req, res) => {
// //   res.send('Hello World!');
// // });

// // app.listen(PORT, () => {
// //   console.log(`Server listening on port ${PORT}`);
// // });

// // Handles server startup and port binding
// const app = require('./app');
// const PORT = process.env.PORT || 3001;

// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });

const express = require('express');
const session = require('cookie-session');
const path = require('path');
const { PORT, SERVER_SESSION_SECRET } = require('./config.js');

let app = express();
app.use(express.static('public'));
app.use(session({ secret: SERVER_SESSION_SECRET, maxAge: 24 * 60 * 60 * 1000 }));
app.use(require('../../src/routes/auth.js'));
app.use(require('../../src/routes/data-management.js'));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}...`));