const express = require('express');
const mysql2 = require('mysql2');
const { Server: SocketIOServer } = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const publicPath = path.join(__dirname, 'www');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Configuração da sessão
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Defina como true se usar HTTPS
}));

// Função para configurar o CORS
const corsOptions = {
    origin:'*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true // Permite credenciais
};

// Aplicar o middleware de CORS
app.use(cors(corsOptions));

// Middleware para parsing de JSON
app.use(express.json());

// Servir arquivos estáticos
app.use(express.static(publicPath));

// Roteamento
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const mysqli = mysql2.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bd_chat',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Endpoint para obter usuários
app.get('/usuarios', (req, res) => {
    const query = "SELECT * FROM usuario";
    mysqli.query(query, (err, results) => {
        if (err) {
            console.error("Erro ao pegar os usuários:", err);
            return res.status(500).json({ error: 'Erro ao pegar os usuários' });
        }
        res.json(results);
    });
});

// Endpoint para obter informações essenciais
app.get('/essencial', (req, res) => {
    res.json({ titulo: "ola" });
});

// Endpoint para cadastro de usuário
app.post('/cadastro', (req, res) => {
    const { nome, senha } = req.body;

    if (!nome || !senha) {
        return res.status(400).json({ error: 'Nome e senha são obrigatórios' });
    }

    const srch = "SELECT * FROM usuario WHERE nome = ?";
    mysqli.query(srch, [nome], (err, results) => {
        if (err) {
            console.error("Erro ao fazer a pesquisa", err);
            return res.status(500).json({ error: 'Erro ao fazer a pesquisa' });
        }
        if (results.length > 0) {
            return res.status(400).json({ error: 'Já existe um usuário com esse nome' });
        } 

        const insert = "INSERT INTO usuario(nome, senha) VALUES(?, ?)";
        mysqli.query(insert, [nome, senha], (err) => {
            if (err) {
                console.error("Erro ao inserir na tabela:", err);
                return res.status(500).json({ error: 'Erro ao cadastrar usuário' });
            }
            res.redirect('/login.html');
        });
    });
});

app.post('/login', (req, res) => {
    const { nome, senha } = req.body;

    if (!nome || !senha) {
        return res.status(400).json({ success: false, message: 'Nome e senha são obrigatórios' });
    }

    const srch = "SELECT * FROM usuario WHERE nome = ? and senha = ?";
    mysqli.query(srch, [nome, senha], (err, results) => {
        if (err) {
            console.error("Erro ao fazer a pesquisa", err);
            return res.status(500).json({ success: false, message: "Erro ao fazer a pesquisa" });
        }

        if (results.length > 0) {
            req.session.user = { nome }; // Armazenar informações do usuário na sessão
            res.json({
                success: true,
                message: 'Login bem-sucedido',
                redirect: '/main.html',
                nome: nome
            });
        } else {
            console.log("Usuário não encontrado");
            res.status(401).json({ success: false, message: "Usuário ou senha incorretos" });
        }
    });
});

// Endpoint para obter mensagens entre dois usuários
app.get('/messages', (req, res) => {
    const { remetente, destinatario } = req.query;

    if (!remetente || !destinatario) {
        return res.status(400).json({ error: 'Parâmetros remetente e destinatário são necessários' });
    }

    const query = `
        SELECT * FROM mensagem
        WHERE (remetente = ? AND destinatario = ?)
        OR (remetente = ? AND destinatario = ?)
        ORDER BY timestamp ASC;
    `;
    
    mysqli.query(query, [remetente, destinatario, destinatario, remetente], (err, results) => {
        if (err) {
            console.error("Erro ao buscar mensagens:", err);
            return res.status(500).json({ error: 'Erro ao buscar mensagens' });
        }
        res.json(results);
    });
});

// Configurar o Socket.IO
io.on('connection', (socket) => {
    let currentUser = null;
    let currentRecipient = null;

    console.log('Novo cliente conectado:', socket.id);

    socket.on('joinChat', ({ remetente, destinatario }) => {
        if (currentUser && currentRecipient) {
            socket.leave(currentUser);
        }
        
        console.log(`${remetente} joined the chat with ${destinatario}`);
        socket.join(remetente);

        currentUser = remetente;
        currentRecipient = destinatario;

        // Enviar mensagens anteriores para o usuário que entrou
        const query = `
            SELECT * FROM mensagem
            WHERE (remetente = ? AND destinatario = ?)
            OR (remetente = ? AND destinatario = ?)
            ORDER BY timestamp ASC;
        `;
    
        mysqli.query(query, [remetente, destinatario, destinatario, remetente], (err, results) => {
            if (err) {
                console.error("Erro ao buscar mensagens:", err);
                return;
            }
            socket.emit('previousMessages', results);
        });
    });

    socket.on('sendMessage', ({ remetente, destinatario, mensagem }) => {
        console.log(`Mensagem recebida de ${remetente} para ${destinatario}: ${mensagem}`);
        
        // Salvar mensagem no banco de dados
        const insert = "INSERT INTO mensagem (remetente, destinatario, mensagem) VALUES (?, ?, ?)";
        mysqli.query(insert, [remetente, destinatario, mensagem], (err) => {
            if (err) {
                console.error("Erro ao salvar mensagem:", err);
                return;
            }
            io.to(destinatario).emit('message', { remetente, mensagem });
        });
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            socket.leave(currentUser);
        }
        console.log('Cliente desconectado:', socket.id);
    });
});

// Iniciar o servidor
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
