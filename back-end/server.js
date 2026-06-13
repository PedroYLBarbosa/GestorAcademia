const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 1. Buscar o resumo das turmas (SQL View)
app.get('/api/turmas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vw_resumo_turmas');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Listar todos os alunos
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await pool.query('SELECT id_aluno, nome, data_nascimento, telefone_fixo FROM ALUNO ORDER BY id_aluno DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Cadastrar um novo aluno
app.post('/api/alunos', async (req, res) => {
  const { nome, data_nascimento, telefone_fixo } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ALUNO (nome, data_nascimento, telefone_fixo) VALUES ($1, $2, $3) RETURNING *',
      [nome, data_nascimento, telefone_fixo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. NOVA ROTA: Realizar Matrícula em uma Turma (Interage com o Trigger de Lotação)
app.post('/api/matriculas', async (req, res) => {
  const { id_aluno, id_turma, id_instrutor } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO MATRICULA (id_aluno, id_turma, id_instrutor) VALUES ($1, $2, $3) RETURNING *',
      [id_aluno, id_turma, id_instrutor]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Se o TRIGGER disparar a exceção, ela cairá aqui e será enviada ao front
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do GestorAcademia rodando na porta ${PORT}`));