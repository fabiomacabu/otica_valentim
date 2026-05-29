const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');

const app = express();
const PORT = 3000;

// ============================================================
// CONFIGURAÇÃO DE CAMINHOS
// ============================================================
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
const ADMIN_PATH = path.join(FRONTEND_PATH, 'admin');
const UPLOAD_PATH = path.join(FRONTEND_PATH, 'img', 'produtos');

if (!fs.existsSync(FRONTEND_PATH)) fs.mkdirSync(FRONTEND_PATH, { recursive: true });
if (!fs.existsSync(ADMIN_PATH)) fs.mkdirSync(ADMIN_PATH, { recursive: true });
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'otica-valentim-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use('/css', express.static(path.join(FRONTEND_PATH, 'css')));
app.use('/js', express.static(path.join(FRONTEND_PATH, 'js')));
app.use('/img', express.static(path.join(FRONTEND_PATH, 'img')));
app.use('/admin', express.static(ADMIN_PATH));

// ============================================================
// BANCO DE DADOS
// ============================================================
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

db.serialize(() => {
    // Clientes
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE,
        telefone TEXT,
        preferencias TEXT,
        newsletter INTEGER DEFAULT 1,
        data_nascimento TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Marcas
    db.run(`CREATE TABLE IF NOT EXISTS marcas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE,
        logo TEXT,
        destaque INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Produtos
    db.run(`CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        descricao TEXT,
        preco REAL NOT NULL,
        categoria TEXT,
        categoria_sexo TEXT DEFAULT 'unissex',
        formato TEXT,
        imagem TEXT,
        destaque INTEGER DEFAULT 0,
        marca_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE SET NULL
    )`);

    // Cupons
    db.run(`CREATE TABLE IF NOT EXISTS cupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        cliente_id INTEGER NOT NULL,
        valor INTEGER DEFAULT 10,
        usado INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )`);

    // Conversas
    db.run(`CREATE TABLE IF NOT EXISTS conversas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        status TEXT DEFAULT 'aberto',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )`);

    // Mensagens
    db.run(`CREATE TABLE IF NOT EXISTS mensagens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversa_id INTEGER NOT NULL,
        remetente TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        lida INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE CASCADE
    )`);

    // Intenções do Bot
    db.run(`CREATE TABLE IF NOT EXISTS bot_intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keywords TEXT NOT NULL,
        response TEXT NOT NULL,
        action TEXT,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('✅ Banco de dados inicializado');
});

// ============================================================
// UPLOAD DE IMAGENS
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_PATH),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// FUNÇÕES AUXILIARES DO CHATBOT
// ============================================================
function addMessage(conversaId, remetente, mensagem) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        db.run(
            "INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES (?, ?, ?, ?)",
            [conversaId, remetente, mensagem, now],
            (err) => { if (err) reject(err); else resolve(); }
        );
    });
}

async function botReply(conversaId, clienteMessage) {
    const lowerMsg = clienteMessage.toLowerCase();
    const intents = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM bot_intents WHERE enabled = 1", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
    let matchedIntent = null;
    for (const intent of intents) {
        const keywords = JSON.parse(intent.keywords);
        for (const kw of keywords) {
            if (lowerMsg.includes(kw.toLowerCase())) {
                matchedIntent = intent;
                break;
            }
        }
        if (matchedIntent) break;
    }
    if (matchedIntent) {
        let response = matchedIntent.response;
        if (matchedIntent.action === 'transferToHuman') {
            await addMessage(conversaId, 'admin', response);
            return;
        }
        await addMessage(conversaId, 'admin', response);
    } else {
        const fallback = `❓ Desculpe, não entendi. Você pode perguntar sobre:\n• Preços e produtos\n• Exame de vista\n• Entrega e pagamento\n• Garantia e trocas\n• Horário de funcionamento\n\nOu digite "menu" para ver as opções.`;
        await addMessage(conversaId, 'admin', fallback);
    }
}

// ============================================================
// ADMIN AUTH
// ============================================================
app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: req.session.isAdmin === true });
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ============================================================
// PRODUTOS
// ============================================================
app.get('/api/produtos', (req, res) => {
    let sql = `SELECT p.*, m.nome as marca_nome FROM produtos p LEFT JOIN marcas m ON p.marca_id = m.id`;
    let params = [];
    let conditions = [];
    if (req.query.categoria) {
        conditions.push("p.categoria = ?");
        params.push(req.query.categoria);
    }
    if (req.query.categoria_sexo && req.query.categoria_sexo !== 'todos') {
        conditions.push("p.categoria_sexo = ?");
        params.push(req.query.categoria_sexo);
    }
    if (req.query.formato && req.query.formato !== 'todos') {
        conditions.push("p.formato = ?");
        params.push(req.query.formato);
    }
    if (req.query.marca_id && req.query.marca_id !== 'todos') {
        conditions.push("p.marca_id = ?");
        params.push(req.query.marca_id);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY p.destaque DESC, p.created_at DESC";
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/produtos/:id', (req, res) => {
    db.get("SELECT * FROM produtos WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

app.post('/api/admin/produtos', upload.single('imagem'), (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, descricao, preco, categoria, categoria_sexo, formato, marca_id, destaque } = req.body;
    const imagem = req.file ? `/img/produtos/${req.file.filename}` : null;
    db.run(`INSERT INTO produtos (nome, descricao, preco, categoria, categoria_sexo, formato, imagem, destaque, marca_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nome, descricao, preco, categoria, categoria_sexo, formato, imagem, destaque || 0, marca_id || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/admin/produtos/:id', upload.single('imagem'), (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, descricao, preco, categoria, categoria_sexo, formato, marca_id, destaque } = req.body;
    let sql = `UPDATE produtos SET nome=?, descricao=?, preco=?, categoria=?, categoria_sexo=?, formato=?, destaque=?, marca_id=?`;
    let params = [nome, descricao, preco, categoria, categoria_sexo, formato, destaque || 0, marca_id || null];
    if (req.file) {
        sql += `, imagem=?`;
        params.push(`/img/produtos/${req.file.filename}`);
    }
    sql += ` WHERE id=?`;
    params.push(req.params.id);
    db.run(sql, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/admin/produtos/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("DELETE FROM produtos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ============================================================
// MARCAS (públicas e admin)
// ============================================================
app.get('/api/marcas', (req, res) => {
    db.all(`SELECT m.*, COUNT(p.id) as total_produtos 
            FROM marcas m 
            LEFT JOIN produtos p ON m.id = p.marca_id 
            GROUP BY m.id 
            ORDER BY m.destaque DESC, m.nome ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.get('/api/marcas/:id', (req, res) => {
    db.get("SELECT * FROM marcas WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// Rota admin para listar marcas (igual à pública, mas exige login)
app.get('/api/admin/marcas', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.all(`SELECT m.*, COUNT(p.id) as total_produtos 
            FROM marcas m 
            LEFT JOIN produtos p ON m.id = p.marca_id 
            GROUP BY m.id 
            ORDER BY m.destaque DESC, m.nome ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.post('/api/admin/marcas', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, logo, destaque } = req.body;
    db.run("INSERT INTO marcas (nome, logo, destaque) VALUES (?, ?, ?)", [nome, logo, destaque || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/admin/marcas/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, logo, destaque } = req.body;
    db.run("UPDATE marcas SET nome=?, logo=?, destaque=? WHERE id=?", [nome, logo, destaque || 0, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/admin/marcas/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("DELETE FROM marcas WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ============================================================
// CLIENTES
// ============================================================
app.get('/api/admin/clientes', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.all("SELECT * FROM clientes ORDER BY created_at DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/clientes/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.get("SELECT * FROM clientes WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

app.put('/api/admin/clientes/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, email, telefone, preferencias, newsletter, data_nascimento } = req.body;
    db.run(`UPDATE clientes SET nome=?, email=?, telefone=?, preferencias=?, newsletter=?, data_nascimento=? WHERE id=?`,
        [nome, email, telefone, preferencias, newsletter, data_nascimento, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/admin/clientes/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("DELETE FROM clientes WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/clientes', (req, res) => {
    const { nome, email, telefone, data_nascimento, preferencias, newsletter } = req.body;
    if (!nome || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    db.get("SELECT * FROM clientes WHERE email = ?", [email], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });
        db.run(`INSERT INTO clientes (nome, email, telefone, data_nascimento, preferencias, newsletter) VALUES (?, ?, ?, ?, ?, ?)`,
            [nome, email, telefone, data_nascimento, preferencias, newsletter ? 1 : 0],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
                db.run("INSERT INTO cupons (codigo, cliente_id, valor) VALUES (?, ?, 10)", [codigo, this.lastID], () => {
                    res.json({ success: true, cupom: codigo, linkWhatsApp: `https://wa.me/5522999416737?text=Olá! Meu cupom é ${codigo} - 10% OFF!` });
                });
            });
    });
});

// ============================================================
// CUPONS
// ============================================================
app.get('/api/admin/cupons', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.all(`SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email FROM cupons c LEFT JOIN clientes cl ON c.cliente_id = cl.id ORDER BY c.created_at DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.get('/api/admin/cupons/stats', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.get(`SELECT COUNT(*) as total, SUM(CASE WHEN usado=1 THEN 1 ELSE 0 END) as usados, SUM(CASE WHEN usado=0 THEN 1 ELSE 0 END) as nao_usados FROM cupons`,
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row);
        });
});

app.post('/api/admin/cupons/gerar', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { cliente_id, valor } = req.body;
    const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
    db.run("INSERT INTO cupons (codigo, cliente_id, valor) VALUES (?, ?, ?)", [codigo, cliente_id, valor || 10],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, codigo });
        });
});

app.put('/api/admin/cupons/usar/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("UPDATE cupons SET usado = 1 WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/admin/cupons/desusar/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("UPDATE cupons SET usado = 0 WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/admin/cupons/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("DELETE FROM cupons WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/admin/reenviar-cupom/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const clienteId = req.params.id;
    db.get("SELECT * FROM clientes WHERE id = ?", [clienteId], (err, cliente) => {
        if (err || !cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
        const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
        db.run("INSERT INTO cupons (codigo, cliente_id, valor) VALUES (?, ?, 10)", [codigo, clienteId], () => {
            res.json({ success: true, linkWhatsApp: `https://wa.me/55${cliente.telefone}?text=Olá ${cliente.nome}! Seu cupom ${codigo} de 10% OFF está disponível!` });
        });
    });
});

// ============================================================
// CHAT – CLIENTE
// ============================================================
app.post('/api/chat/nova-conversa', (req, res) => {
    const { nome, email, telefone, mensagem } = req.body;
    if (!nome || !email) return res.status(400).json({ success: false, error: 'Nome e e-mail obrigatórios' });
    db.get("SELECT * FROM clientes WHERE email = ?", [email], (err, cliente) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const criarConversa = (clienteId) => {
            const now = new Date().toISOString();
            db.run("INSERT INTO conversas (cliente_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [clienteId, 'aberto', now, now],
                function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });
                    const conversaId = this.lastID;
                    if (mensagem && mensagem.trim()) {
                        db.run("INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES (?, ?, ?, ?)",
                            [conversaId, 'cliente', mensagem.trim(), now]);
                    }
                    res.json({ success: true, conversa_id: conversaId });
                });
        };
        if (cliente) criarConversa(cliente.id);
        else {
            db.run("INSERT INTO clientes (nome, email, telefone) VALUES (?, ?, ?)", [nome, email, telefone || null],
                function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });
                    criarConversa(this.lastID);
                });
        }
    });
});

app.post('/api/chat/enviar-mensagem', async (req, res) => {
    const { conversa_id, mensagem, remetente } = req.body;
    if (!conversa_id || !mensagem) return res.status(400).json({ error: 'Dados incompletos' });
    const now = new Date().toISOString();
    await new Promise((resolve, reject) => {
        db.run("INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES (?, ?, ?, ?)",
            [conversa_id, remetente || 'cliente', mensagem, now], (err) => { if (err) reject(err); else resolve(); });
    });
    db.run("UPDATE conversas SET updated_at = ? WHERE id = ?", [now, conversa_id]);
    if (remetente === 'cliente') {
        const conversa = await new Promise((resolve, reject) => {
            db.get("SELECT status FROM conversas WHERE id = ?", [conversa_id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });
        if (conversa && conversa.status === 'aberto') {
            botReply(conversa_id, mensagem).catch(console.error);
        }
    }
    res.json({ success: true });
});

app.get('/api/chat/mensagens/:conversa_id', (req, res) => {
    db.all("SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY created_at ASC", [req.params.conversa_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
});

app.post('/api/chat/fechar-conversa/:conversa_id', (req, res) => {
    db.run("UPDATE conversas SET status = 'fechado', updated_at = ? WHERE id = ?", [new Date().toISOString(), req.params.conversa_id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// Obter detalhes da conversa (incluindo nome do cliente)
app.get('/api/chat/conversa/:id', (req, res) => {
    const { id } = req.params;
    db.get(`
        SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email, cl.telefone 
        FROM conversas c
        JOIN clientes cl ON c.cliente_id = cl.id
        WHERE c.id = ?
    `, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Conversa não encontrada' });
        res.json(row);
    });
});

// ============================================================
// ADMIN – CHAT
// ============================================================
app.get('/api/admin/conversas', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.all(`SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email, cl.telefone as cliente_telefone FROM conversas c JOIN clientes cl ON c.cliente_id = cl.id ORDER BY c.updated_at DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.post('/api/admin/marcar-lidas/:conversa_id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("UPDATE mensagens SET lida = 1 WHERE conversa_id = ? AND remetente = 'cliente'", [req.params.conversa_id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.post('/api/admin/enviar-mensagem', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { conversa_id, mensagem } = req.body;
    if (!conversa_id || !mensagem) return res.status(400).json({ error: 'Dados incompletos' });
    db.get("SELECT status FROM conversas WHERE id = ?", [conversa_id], (err, conversa) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conversa || conversa.status !== 'aberto') return res.status(400).json({ error: 'Conversa encerrada' });
        const now = new Date().toISOString();
        db.run("INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES (?, ?, ?, ?)",
            [conversa_id, 'admin', mensagem, now], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.run("UPDATE conversas SET updated_at = ? WHERE id = ?", [now, conversa_id]);
                res.json({ success: true });
            });
    });
});

app.post('/api/admin/fechar-conversa/:conversa_id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("UPDATE conversas SET status = 'fechado', updated_at = ? WHERE id = ?", [new Date().toISOString(), req.params.conversa_id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// ============================================================
// ADMIN – BOT INTENTS (CRUD)
// ============================================================
app.get('/api/admin/bot-intents', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.all("SELECT * FROM bot_intents ORDER BY created_at DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/bot-intents', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { keywords, response, action, enabled } = req.body;
    if (!keywords || !response) return res.status(400).json({ error: 'Palavras-chave e resposta obrigatórios' });
    db.run("INSERT INTO bot_intents (keywords, response, action, enabled) VALUES (?, ?, ?, ?)",
        [JSON.stringify(keywords), response, action || null, enabled !== undefined ? enabled : 1],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/admin/bot-intents/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { keywords, response, action, enabled } = req.body;
    db.run(`UPDATE bot_intents SET keywords = ?, response = ?, action = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(keywords), response, action || null, enabled !== undefined ? enabled : 1, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/admin/bot-intents/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    db.run("DELETE FROM bot_intents WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ============================================================
// ROTAS DE PÁGINAS (FRONTEND)
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

app.get('/:page.html', (req, res) => {
    const filePath = path.join(FRONTEND_PATH, req.params.page + '.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Página não encontrada');
});

app.get('/admin/login.html', (req, res) => {
    res.sendFile(path.join(ADMIN_PATH, 'login.html'));
});

app.get('/admin/:page.html', (req, res) => {
    if (!req.session.isAdmin && req.params.page !== 'login') {
        return res.redirect('/admin/login.html');
    }
    const filePath = path.join(ADMIN_PATH, req.params.page + '.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Página não encontrada');
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
    console.log(`
    ═══════════════════════════════════════════════════════════
    🚀 SERVIDOR ÓTICA VALENTIM - INICIADO COM SUCESSO!
    ═══════════════════════════════════════════════════════════
    
    📍 URL: http://localhost:${PORT}
    📁 Frontend: ${FRONTEND_PATH}
    📁 Admin: ${ADMIN_PATH}
    📁 Uploads: ${UPLOAD_PATH}
    🗄️  Banco: ${path.join(__dirname, 'database.sqlite')}
    
    🔐 Acesso Admin:
       👤 Usuário: admin
       🔑 Senha: admin123
    
    ═══════════════════════════════════════════════════════════
    `);
});