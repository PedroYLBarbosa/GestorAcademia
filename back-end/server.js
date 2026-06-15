const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Rota de Login para Funcionários e Alunos
app.post("/api/login", async (req, res) => {
  const { cpf, senha } = req.body;

  if (!cpf || !senha) {
    return res
      .status(400)
      .json({ sucesso: false, mensagem: "Preencha CPF e senha." });
  }

  const queryLogin = `
        SELECT 
            f.id_funcionario AS id_usuario, 
            f.nome,
            CASE 
                WHEN g.id_funcionario IS NOT NULL THEN 'Gerente'
                WHEN i.id_funcionario IS NOT NULL THEN 'Instrutor'
                ELSE 'Funcionario'
            END AS tipo_usuario
        FROM FUNCIONARIO f
        LEFT JOIN GERENTE g ON f.id_funcionario = g.id_funcionario
        LEFT JOIN INSTRUTOR i ON f.id_funcionario = i.id_funcionario
        WHERE f.cpf = $1 AND f.senha = $2

        UNION ALL

        SELECT 
            a.id_aluno AS id_usuario, 
            a.nome,
            'Aluno' AS tipo_usuario
        FROM ALUNO a
        WHERE a.cpf = $1 AND a.senha = $2;
    `;

  try {
    const { rows } = await pool.query(queryLogin, [cpf, senha]);

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ sucesso: false, mensagem: "CPF ou senha incorretos." });
    }

    res.status(200).json({
      sucesso: true,
      usuario: rows[0],
    });
  } catch (erro) {
    console.error("Erro na rota de login:", erro);
    res
      .status(500)
      .json({ sucesso: false, mensagem: "Erro ao processar o login." });
  }
});



app.post("/api/treinos", async (req, res) => {
  const { id_aluno, nome_programa, objetivo, observacoes_gerais } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertPlano = `
      INSERT INTO PLANO_TREINO (nome_programa, objetivo, observacoes_gerais) 
      VALUES ($1, $2, $3) 
      RETURNING id_plano_treino
    `;
    const planoResult = await client.query(insertPlano, [
      nome_programa,
      objetivo,
      observacoes_gerais,
    ]);
    const idPlano = planoResult.rows[0].id_plano_treino;

    const updateAluno = `
      UPDATE ALUNO 
      SET id_plano_treino = $1 
      WHERE id_aluno = $2
    `;
    await client.query(updateAluno, [idPlano, id_aluno]);

    await client.query("COMMIT");
    res.status(201).json({ sucesso: true, id_plano_treino: idPlano });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Buscar o resumo das turmas (SQL View)
app.get("/api/turmas", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM vw_resumo_turmas");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instrutores/:id_instrutor/turmas', async (req, res) => {
  const { id_instrutor } = req.params;
  try {
    const query = `
      SELECT DISTINCT
        t.id_turma,
        t.horario,
        t.vagas_maximas,
        COALESCE(agn.nome_activity, 'Geral') AS atividade,
        (SELECT COUNT(*) FROM MATRICULA WHERE id_turma = t.id_turma) AS total_alunos
      FROM TURMA t
      INNER JOIN MATRICULA m ON t.id_turma = m.id_turma
      LEFT JOIN (
        SELECT id_atividade_grupo, MIN(nome_atividade) AS nome_activity
        FROM ATIVIDADE_GRUPO_NOME
        GROUP BY id_atividade_grupo
      ) agn ON t.id_atividade_grupo = agn.id_atividade_grupo
      WHERE m.id_instrutor = $1
      ORDER BY t.id_turma ASC
    `;
    const result = await pool.query(query, [id_instrutor]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instrutores/:id_instrutor/alunos', async (req, res) => {
  const { id_instrutor } = req.params;
  try {
    const query = `
      SELECT 
        a.id_aluno,
        a.nome AS aluno_nome,
        COALESCE(agn.nome_activity, 'Sem Turma') AS turma_nome,
        COALESCE(pt.nome_programa, 'Sem Plano') AS plano_nome,
        COALESCE(pt.objetivo, 'Não definido') AS plano_objetivo,
        COALESCE(pt.observacoes_gerais, 'Sem exercícios cadastrados') AS plano_detalhes
      FROM ALUNO a
      INNER JOIN MATRICULA m ON a.id_aluno = m.id_aluno
      LEFT JOIN TURMA t ON m.id_turma = t.id_turma
      LEFT JOIN (
        SELECT id_atividade_grupo, MIN(nome_atividade) AS nome_activity
        FROM ATIVIDADE_GRUPO_NOME
        GROUP BY id_atividade_grupo
      ) agn ON t.id_atividade_grupo = agn.id_atividade_grupo
      LEFT JOIN PLANO_TREINO pt ON a.id_plano_treino = pt.id_plano_treino
      WHERE m.id_instrutor = $1
      ORDER BY a.nome ASC
    `;
    const result = await pool.query(query, [id_instrutor]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Listar todos os alunos
app.get("/api/alunos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id_aluno, nome, data_nascimento, telefone_fixo FROM ALUNO ORDER BY id_aluno DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//consultar alunos por nome com substring.
app.get("/api/alunos/:nome", async (req, res) => {
  const { nome } = req.params;
  try {
    const result = await pool.query(
      "SELECT id_aluno, nome, data_nascimento, telefone_fixo FROM ALUNO WHERE nome ILIKE $1",
      [`%${nome}%`],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Cadastrar um novo aluno
app.post("/api/alunos", async (req, res) => {
  const { nome, data_nascimento, telefone_fixo } = req.body;
  try {
    const cpfAleatorio = Math.floor(
      10000000000 + Math.random() * 90000000000,
    ).toString();
    const senhaPadrao = "1234";

    const result = await pool.query(
      "INSERT INTO ALUNO (nome, data_nascimento, telefone_fixo, cpf, senha) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [nome, data_nascimento, telefone_fixo, cpfAleatorio, senhaPadrao],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao cadastrar aluno:", err);
    res.status(500).json({ error: err.message });
  }
});
//Realizar Matrícula em uma Turma (Interage com o Trigger de Lotação)
app.post("/api/matriculas", async (req, res) => {
  const { id_aluno, id_turma, id_instrutor } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO MATRICULA (id_aluno, id_turma, id_instrutor) VALUES ($1, $2, $3) RETURNING *",
      [id_aluno, id_turma, id_instrutor],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Se o TRIGGER disparar a exceção, ela cairá aqui e será enviada ao front-end
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// ROTAS DO GERENTE (Gestão de Instrutores)
// ==========================================

// Listar instrutores gerenciados por um gerente específico
app.get("/api/gerentes/:id_gerente/instrutores", async (req, res) => {
  const { id_gerente } = req.params;

  try {
    const query = `
            SELECT 
                f.id_funcionario, 
                f.nome, 
                i.cref, 
                i.especialidade, 
                i.horario_disp 
            FROM INSTRUTOR i
            INNER JOIN FUNCIONARIO f ON i.id_funcionario = f.id_funcionario
            WHERE i.id_gerente = $1
        `;
    const result = await pool.query(query, [id_gerente]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao listar instrutores:", err);
    res.status(500).json({ error: err.message });
  }
});

//Editar dados profissionais do Instrutor
app.put("/api/instrutores/:id_funcionario", async (req, res) => {
  const { id_funcionario } = req.params;
  const { cref, especialidade, horario_disp } = req.body;

  try {
    const query = `
            UPDATE INSTRUTOR 
            SET cref = $1, especialidade = $2, horario_disp = $3 
            WHERE id_funcionario = $4 
            RETURNING *
        `;
    const result = await pool.query(query, [
      cref,
      especialidade,
      horario_disp,
      id_funcionario,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ sucesso: false, mensagem: "Instrutor não encontrado." });
    }

    res.status(200).json({ sucesso: true, instrutor: result.rows[0] });
  } catch (err) {
    console.error("Erro ao editar instrutor:", err);
    res.status(500).json({ error: err.message });
  }
});

//Excluir Funcionário/Instrutor do sistema
app.delete("/api/instrutores/:id_funcionario", async (req, res) => {
  const { id_funcionario } = req.params;

  try {
    const query =
      "DELETE FROM FUNCIONARIO WHERE id_funcionario = $1 RETURNING *";
    const result = await pool.query(query, [id_funcionario]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({
          sucesso: false,
          mensagem: "Funcionário/Instrutor não encontrado.",
        });
    }

    res
      .status(200)
      .json({
        sucesso: true,
        mensagem: "Instrutor removido permanentemente do sistema.",
      });
  } catch (err) {
    console.error("Erro ao excluir instrutor:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/funcionarios/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const query =
      "SELECT id_funcionario, nome, cpf, data_admissao, telefone FROM FUNCIONARIO WHERE id_funcionario = $1";
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0)
      return res.status(404).json({ erro: "Funcionário não encontrado." });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/funcionarios/:id", async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, senha } = req.body;

  try {
    const query = `
            UPDATE FUNCIONARIO 
            SET nome = $1, 
                telefone = $2, 
                senha = COALESCE(NULLIF($3, ''), senha)
            WHERE id_funcionario = $4 
            RETURNING id_funcionario, nome, telefone
        `;
    const result = await pool.query(query, [nome, telefone, senha, id]);

    res.status(200).json({ sucesso: true, funcionario: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Servidor do GestorAcademia rodando na porta ${PORT}`),
);
