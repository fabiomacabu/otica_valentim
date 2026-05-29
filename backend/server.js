const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CONFIGURAÇÃO DE CAMINHOS (FRONTEND) ==========
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
const ADMIN_PATH = path.join(FRONTEND_PATH, 'admin');
const UPLOAD_PATH = path.join(FRONTEND_PATH, 'img', 'produtos');

if (!fs.existsSync(FRONTEND_PATH)) fs.mkdirSync(FRONTEND_PATH, { recursive: true });
if (!fs.existsSync(ADMIN_PATH)) fs.mkdirSync(ADMIN_PATH, { recursive: true });
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== CONEXÃO COM POSTGRESQL ==========
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ========== CRIAÇÃO DAS TABELAS ==========
const createTables = async () => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS clientes (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            email TEXT UNIQUE,
            telefone TEXT,
            preferencias TEXT,
            newsletter INTEGER DEFAULT 1,
            data_nascimento TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS marcas (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL UNIQUE,
            logo TEXT,
            destaque INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS produtos (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            descricao TEXT,
            preco REAL NOT NULL,
            categoria TEXT,
            categoria_sexo TEXT DEFAULT 'unissex',
            formato TEXT,
            imagem TEXT,
            destaque INTEGER DEFAULT 0,
            marca_id INTEGER REFERENCES marcas(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS cupons (
            id SERIAL PRIMARY KEY,
            codigo TEXT NOT NULL UNIQUE,
            cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
            valor INTEGER DEFAULT 10,
            usado INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS conversas (
            id SERIAL PRIMARY KEY,
            cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
            status TEXT DEFAULT 'aberto',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS mensagens (
            id SERIAL PRIMARY KEY,
            conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
            remetente TEXT NOT NULL,
            mensagem TEXT NOT NULL,
            lida INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS bot_intents (
            id SERIAL PRIMARY KEY,
            keywords TEXT NOT NULL,
            response TEXT NOT NULL,
            action TEXT,
            enabled INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS "session" (
            "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL
        )`
    ];
    for (const query of queries) {
        await pool.query(query);
    }
    console.log('✅ Tabelas verificadas/criadas');
};

(async () => {
    await createTables();
})();

// ========== SESSÃO (armazenada no PostgreSQL) ==========
app.use(session({
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET || 'otica-valentim-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ========== ARQUIVOS ESTÁTICOS ==========
app.use('/css', express.static(path.join(FRONTEND_PATH, 'css')));
app.use('/js', express.static(path.join(FRONTEND_PATH, 'js')));
app.use('/img', express.static(path.join(FRONTEND_PATH, 'img')));
app.use('/admin', express.static(ADMIN_PATH));

// ========== UPLOAD DE IMAGENS ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_PATH),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ========== FUNÇÕES AUXILIARES DO CHATBOT ==========
async function addMessage(conversaId, remetente, mensagem) {
    await pool.query(
        `INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [conversaId, remetente, mensagem]
    );
}

async function botReply(conversaId, clienteMessage) {
    const lowerMsg = clienteMessage.toLowerCase();
    const { rows: intents } = await pool.query(
        `SELECT * FROM bot_intents WHERE enabled = 1`
    );
    let matchedIntent = null;
    for (const intent of intents) {
        const keywords = JSON.parse(intent.keywords);
        if (keywords.some(kw => lowerMsg.includes(kw.toLowerCase()))) {
            matchedIntent = intent;
            break;
        }
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

// ========== ENDPOINTS ==========

// ===== ADMIN AUTH =====
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

// ===== PRODUTOS =====
app.get('/api/produtos', async (req, res) => {
    try {
        let sql = `SELECT p.*, m.nome as marca_nome FROM produtos p LEFT JOIN marcas m ON p.marca_id = m.id`;
        const conditions = [];
        const values = [];
        if (req.query.categoria) {
            conditions.push(`p.categoria = $${values.length + 1}`);
            values.push(req.query.categoria);
        }
        if (req.query.categoria_sexo && req.query.categoria_sexo !== 'todos') {
            conditions.push(`p.categoria_sexo = $${values.length + 1}`);
            values.push(req.query.categoria_sexo);
        }
        if (req.query.formato && req.query.formato !== 'todos') {
            conditions.push(`p.formato = $${values.length + 1}`);
            values.push(req.query.formato);
        }
        if (req.query.marca_id && req.query.marca_id !== 'todos') {
            conditions.push(`p.marca_id = $${values.length + 1}`);
            values.push(req.query.marca_id);
        }
        if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
        sql += " ORDER BY p.destaque DESC, p.created_at DESC";
        const { rows } = await pool.query(sql, values);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/produtos/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM produtos WHERE id = $1', [req.params.id]);
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/produtos', upload.single('imagem'), async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, descricao, preco, categoria, categoria_sexo, formato, marca_id, destaque } = req.body;
    const imagem = req.file ? `/img/produtos/${req.file.filename}` : null;
    try {
        const result = await pool.query(
            `INSERT INTO produtos (nome, descricao, preco, categoria, categoria_sexo, formato, imagem, destaque, marca_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [nome, descricao, preco, categoria, categoria_sexo, formato, imagem, destaque || 0, marca_id || null]
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/produtos/:id', upload.single('imagem'), async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, descricao, preco, categoria, categoria_sexo, formato, marca_id, destaque } = req.body;
    let sql = `UPDATE produtos SET nome=$1, descricao=$2, preco=$3, categoria=$4, categoria_sexo=$5, formato=$6, destaque=$7, marca_id=$8`;
    let params = [nome, descricao, preco, categoria, categoria_sexo, formato, destaque || 0, marca_id || null];
    if (req.file) {
        sql += `, imagem=$9`;
        params.push(`/img/produtos/${req.file.filename}`);
        sql += ` WHERE id=$10`;
        params.push(req.params.id);
    } else {
        sql += ` WHERE id=$9`;
        params.push(req.params.id);
    }
    try {
        await pool.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/produtos/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== MARCAS (públicas) =====
app.get('/api/marcas', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT m.*, COUNT(p.id) as total_produtos
             FROM marcas m
             LEFT JOIN produtos p ON m.id = p.marca_id
             GROUP BY m.id
             ORDER BY m.destaque DESC, m.nome ASC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/marcas/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM marcas WHERE id = $1', [req.params.id]);
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ADMIN MARCAS (listagem protegida) =====
app.get('/api/admin/marcas', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query(
            `SELECT m.*, COUNT(p.id) as total_produtos
             FROM marcas m
             LEFT JOIN produtos p ON m.id = p.marca_id
             GROUP BY m.id
             ORDER BY m.destaque DESC, m.nome ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/marcas', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, logo, destaque } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO marcas (nome, logo, destaque) VALUES ($1, $2, $3) RETURNING id',
            [nome, logo, destaque || 0]
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/marcas/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, logo, destaque } = req.body;
    try {
        await pool.query(
            'UPDATE marcas SET nome=$1, logo=$2, destaque=$3 WHERE id=$4',
            [nome, logo, destaque || 0, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/marcas/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('DELETE FROM marcas WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CLIENTES =====
app.get('/api/admin/clientes', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query('SELECT * FROM clientes ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/clientes/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/clientes/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { nome, email, telefone, preferencias, newsletter, data_nascimento } = req.body;
    try {
        await pool.query(
            `UPDATE clientes SET nome=$1, email=$2, telefone=$3, preferencias=$4, newsletter=$5, data_nascimento=$6 WHERE id=$7`,
            [nome, email, telefone, preferencias, newsletter, data_nascimento, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/clientes/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clientes', async (req, res) => {
    const { nome, email, telefone, data_nascimento, preferencias, newsletter } = req.body;
    if (!nome || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    try {
        const existing = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
        if (existing.rows.length) {
            return res.status(400).json({ error: 'Este e-mail já está cadastrado' });
        }
        const result = await pool.query(
            `INSERT INTO clientes (nome, email, telefone, data_nascimento, preferencias, newsletter)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [nome, email, telefone, data_nascimento, preferencias, newsletter ? 1 : 0]
        );
        const clienteId = result.rows[0].id;
        const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
        await pool.query('INSERT INTO cupons (codigo, cliente_id, valor) VALUES ($1, $2, 10)', [codigo, clienteId]);
        res.json({
            success: true,
            cupom: codigo,
            linkWhatsApp: `https://wa.me/5522999416737?text=Olá! Meu cupom é ${codigo} - 10% OFF!`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CUPONS =====
app.get('/api/admin/cupons', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query(
            `SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email
             FROM cupons c
             LEFT JOIN clientes cl ON c.cliente_id = cl.id
             ORDER BY c.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/cupons/stats', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query(
            `SELECT COUNT(*) as total,
                    SUM(CASE WHEN usado=1 THEN 1 ELSE 0 END) as usados,
                    SUM(CASE WHEN usado=0 THEN 1 ELSE 0 END) as nao_usados
             FROM cupons`
        );
        res.json(rows[0] || { total: 0, usados: 0, nao_usados: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/cupons/gerar', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { cliente_id, valor } = req.body;
    const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
    try {
        await pool.query('INSERT INTO cupons (codigo, cliente_id, valor) VALUES ($1, $2, $3)', [codigo, cliente_id, valor || 10]);
        res.json({ success: true, codigo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/cupons/usar/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('UPDATE cupons SET usado = 1 WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/cupons/desusar/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('UPDATE cupons SET usado = 0 WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/cupons/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('DELETE FROM cupons WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reenviar-cupom/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const clienteId = req.params.id;
    try {
        const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
        if (!rows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
        const cliente = rows[0];
        const codigo = 'VALENTIM' + Math.floor(Math.random() * 10000);
        await pool.query('INSERT INTO cupons (codigo, cliente_id, valor) VALUES ($1, $2, 10)', [codigo, clienteId]);
        res.json({
            success: true,
            linkWhatsApp: `https://wa.me/55${cliente.telefone}?text=Olá ${cliente.nome}! Seu cupom ${codigo} de 10% OFF está disponível!`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CHAT (CLIENTE) =====
app.post('/api/chat/nova-conversa', async (req, res) => {
    const { nome, email, telefone, mensagem } = req.body;
    if (!nome || !email) return res.status(400).json({ success: false, error: 'Nome e e-mail obrigatórios' });
    try {
        let clienteId;
        const existing = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
        if (existing.rows.length) {
            clienteId = existing.rows[0].id;
        } else {
            const insert = await pool.query(
                'INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3) RETURNING id',
                [nome, email, telefone || null]
            );
            clienteId = insert.rows[0].id;
        }
        const now = new Date().toISOString();
        const conv = await pool.query(
            'INSERT INTO conversas (cliente_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
            [clienteId, 'aberto', now, now]
        );
        const conversaId = conv.rows[0].id;
        if (mensagem && mensagem.trim()) {
            await pool.query(
                'INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES ($1, $2, $3, $4)',
                [conversaId, 'cliente', mensagem.trim(), now]
            );
        }
        res.json({ success: true, conversa_id: conversaId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/enviar-mensagem', async (req, res) => {
    const { conversa_id, mensagem, remetente } = req.body;
    if (!conversa_id || !mensagem) return res.status(400).json({ error: 'Dados incompletos' });
    const now = new Date().toISOString();
    try {
        await pool.query(
            'INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES ($1, $2, $3, $4)',
            [conversa_id, remetente || 'cliente', mensagem, now]
        );
        await pool.query('UPDATE conversas SET updated_at = $1 WHERE id = $2', [now, conversa_id]);
        if (remetente === 'cliente') {
            const { rows } = await pool.query('SELECT status FROM conversas WHERE id = $1', [conversa_id]);
            if (rows[0] && rows[0].status === 'aberto') {
                botReply(conversa_id, mensagem).catch(console.error);
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat/mensagens/:conversa_id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM mensagens WHERE conversa_id = $1 ORDER BY created_at ASC',
            [req.params.conversa_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat/fechar-conversa/:conversa_id', async (req, res) => {
    try {
        await pool.query('UPDATE conversas SET status = $1, updated_at = $2 WHERE id = $3', ['fechado', new Date().toISOString(), req.params.conversa_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat/conversa/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email, cl.telefone
             FROM conversas c
             JOIN clientes cl ON c.cliente_id = cl.id
             WHERE c.id = $1`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ADMIN CHAT =====
app.get('/api/admin/conversas', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query(
            `SELECT c.*, cl.nome as cliente_nome, cl.email as cliente_email, cl.telefone as cliente_telefone
             FROM conversas c
             JOIN clientes cl ON c.cliente_id = cl.id
             ORDER BY c.updated_at DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/marcar-lidas/:conversa_id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('UPDATE mensagens SET lida = 1 WHERE conversa_id = $1 AND remetente = $2', [req.params.conversa_id, 'cliente']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/enviar-mensagem', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { conversa_id, mensagem } = req.body;
    if (!conversa_id || !mensagem) return res.status(400).json({ error: 'Dados incompletos' });
    try {
        const { rows } = await pool.query('SELECT status FROM conversas WHERE id = $1', [conversa_id]);
        if (!rows.length || rows[0].status !== 'aberto') return res.status(400).json({ error: 'Conversa encerrada' });
        const now = new Date().toISOString();
        await pool.query('INSERT INTO mensagens (conversa_id, remetente, mensagem, created_at) VALUES ($1, $2, $3, $4)', [conversa_id, 'admin', mensagem, now]);
        await pool.query('UPDATE conversas SET updated_at = $1 WHERE id = $2', [now, conversa_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/fechar-conversa/:conversa_id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('UPDATE conversas SET status = $1, updated_at = $2 WHERE id = $3', ['fechado', new Date().toISOString(), req.params.conversa_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ADMIN BOT INTENTS =====
app.get('/api/admin/bot-intents', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        const { rows } = await pool.query('SELECT * FROM bot_intents ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/bot-intents', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { keywords, response, action, enabled } = req.body;
    if (!keywords || !response) return res.status(400).json({ error: 'Palavras-chave e resposta obrigatórios' });
    try {
        const result = await pool.query(
            'INSERT INTO bot_intents (keywords, response, action, enabled) VALUES ($1, $2, $3, $4) RETURNING id',
            [JSON.stringify(keywords), response, action || null, enabled !== undefined ? enabled : 1]
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/bot-intents/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    const { keywords, response, action, enabled } = req.body;
    try {
        await pool.query(
            `UPDATE bot_intents SET keywords=$1, response=$2, action=$3, enabled=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5`,
            [JSON.stringify(keywords), response, action || null, enabled !== undefined ? enabled : 1, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/bot-intents/:id', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    try {
        await pool.query('DELETE FROM bot_intents WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ROTAS DE PÁGINAS =====
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

// ===== INICIAR SERVIDOR =====
app.listen(PORT, () => {
    console.log(`
    ═══════════════════════════════════════════════════════════
    🚀 SERVIDOR ÓTICA VALENTIM - RODANDO!
    ═══════════════════════════════════════════════════════════
    📍 URL: http://localhost:${PORT}
    📁 Frontend: ${FRONTEND_PATH}
    📁 Admin: ${ADMIN_PATH}
    🗄️  Banco: PostgreSQL (via DATABASE_URL)
    ═══════════════════════════════════════════════════════════
    `);
});