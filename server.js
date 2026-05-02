const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─────────────────────────────────────────────
//  ALGORITMO DE ENCAIXE / LAYOUT
// ─────────────────────────────────────────────

/**
 * Organiza peças em grade com espaçamento mínimo configurável.
 * Suporta rotação individual por peça.
 *
 * Entrada esperada:
 * {
 *   pecas: [{ id, largura, altura, nome }],
 *   config: {
 *     espacamento:  5,       // mm entre peças
 *     colunas:      4,       // 0 = automático (raiz quadrada)
 *     angulo:       0,       // graus – aplica a TODAS as peças
 *     origemX:      0,       // ponto de início X na página
 *     origemY:      0,       // ponto de início Y na página
 *     alinharCentro: false,  // centralizar na coluna
 *     ordenarPor:   "area"   // "area" | "largura" | "altura" | "nome" | "original"
 *   }
 * }
 */
function calcularLayout(pecas, config) {
  const {
    espacamento   = 5,
    colunas       = 0,
    angulo        = 0,
    origemX       = 0,
    origemY       = 0,
    alinharCentro = false,
    ordenarPor    = "area"
  } = config;

  if (!pecas || pecas.length === 0) {
    return { posicoes: [], estatisticas: { total: 0 } };
  }

  // 1. Ordenar peças para melhor encaixe
  const pecasOrdenadas = ordenarPecas([...pecas], ordenarPor);

  // 2. Determinar número de colunas
  const numColunas = colunas > 0 ? colunas : Math.ceil(Math.sqrt(pecasOrdenadas.length));

  // 3. Calcular largura máxima por coluna e altura máxima por linha
  const largurasColunas = new Array(numColunas).fill(0);
  const alturasLinhas   = [];

  pecasOrdenadas.forEach((peca, i) => {
    const col = i % numColunas;
    const row = Math.floor(i / numColunas);

    // Dimensões efetivas após rotação
    const { larguraEfetiva, alturaEfetiva } = dimensoesRotacionadas(peca.largura, peca.altura, angulo + (peca.anguloExtra || 0));

    largurasColunas[col] = Math.max(largurasColunas[col], larguraEfetiva);

    if (!alturasLinhas[row]) alturasLinhas[row] = 0;
    alturasLinhas[row] = Math.max(alturasLinhas[row], alturaEfetiva);
  });

  // 4. Calcular posições acumuladas
  const xColunas = [origemX];
  for (let c = 0; c < numColunas - 1; c++) {
    xColunas.push(xColunas[c] + largurasColunas[c] + espacamento);
  }

  const yLinhas = [origemY];
  for (let r = 0; r < alturasLinhas.length - 1; r++) {
    yLinhas.push(yLinhas[r] + alturasLinhas[r] + espacamento);
  }

  // 5. Montar resultado
  const posicoes = pecasOrdenadas.map((peca, i) => {
    const col = i % numColunas;
    const row = Math.floor(i / numColunas);
    const anguloFinal = angulo + (peca.anguloExtra || 0);
    const { larguraEfetiva, alturaEfetiva } = dimensoesRotacionadas(peca.largura, peca.altura, anguloFinal);

    let x = xColunas[col];
    let y = yLinhas[row];

    // Centralizar dentro da célula da coluna
    if (alinharCentro) {
      x += (largurasColunas[col] - larguraEfetiva) / 2;
    }

    return {
      id:        peca.id,
      nome:      peca.nome || `Peça ${i + 1}`,
      x:         arredondar(x),
      y:         arredondar(y),
      largura:   peca.largura,
      altura:    peca.altura,
      rotacao:   anguloFinal,
      coluna:    col,
      linha:     row
    };
  });

  // 6. Estatísticas
  const totalLargura = xColunas[xColunas.length - 1] + largurasColunas[largurasColunas.length - 1];
  const totalAltura  = yLinhas[yLinhas.length - 1]   + alturasLinhas[alturasLinhas.length - 1];
  const areaTotal    = totalLargura * totalAltura;
  const areaPecas    = pecas.reduce((s, p) => s + p.largura * p.altura, 0);

  return {
    posicoes,
    estatisticas: {
      total:          pecas.length,
      colunas:        numColunas,
      linhas:         alturasLinhas.length,
      larguraTotal:   arredondar(totalLargura),
      alturaTotal:    arredondar(totalAltura),
      aproveitamento: arredondar((areaPecas / areaTotal) * 100) + '%'
    }
  };
}

function ordenarPecas(pecas, criterio) {
  switch (criterio) {
    case 'area':
      return pecas.sort((a, b) => (b.largura * b.altura) - (a.largura * a.altura));
    case 'largura':
      return pecas.sort((a, b) => b.largura - a.largura);
    case 'altura':
      return pecas.sort((a, b) => b.altura - a.altura);
    case 'nome':
      return pecas.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    default:
      return pecas; // mantém ordem original
  }
}

function dimensoesRotacionadas(largura, altura, angulo) {
  if (angulo % 90 === 0 && angulo % 180 !== 0) {
    // 90° ou 270° – troca dimensões
    return { larguraEfetiva: altura, alturaEfetiva: largura };
  }
  if (angulo % 180 === 0) {
    return { larguraEfetiva: largura, alturaEfetiva: altura };
  }
  // Ângulo livre – bounding box real
  const rad = (angulo * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    larguraEfetiva: largura * cos + altura * sin,
    alturaEfetiva:  largura * sin + altura * cos
  };
}

function arredondar(n) {
  return Math.round(n * 1000) / 1000;
}

// ─────────────────────────────────────────────
//  ROTAS
// ─────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', versao: '1.0.0', hora: new Date().toISOString() });
});

// Calcular layout
app.post('/calcular', (req, res) => {
  try {
    const { pecas, config } = req.body;

    if (!Array.isArray(pecas) || pecas.length === 0) {
      return res.status(400).json({ erro: 'Envie ao menos uma peça em "pecas".' });
    }

    // Validar cada peça
    for (const p of pecas) {
      if (!p.id)      return res.status(400).json({ erro: `Peça sem "id": ${JSON.stringify(p)}` });
      if (!p.largura) return res.status(400).json({ erro: `Peça "${p.id}" sem "largura".` });
      if (!p.altura)  return res.status(400).json({ erro: `Peça "${p.id}" sem "altura".` });
    }

    const resultado = calcularLayout(pecas, config || {});
    res.json(resultado);

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
});

// Sugestão automática de colunas para um conjunto de peças
app.post('/sugerir-colunas', (req, res) => {
  try {
    const { pecas, larguraMaxima } = req.body;
    if (!Array.isArray(pecas)) return res.status(400).json({ erro: 'Envie "pecas".' });

    const sugestoes = [];
    for (let c = 1; c <= pecas.length; c++) {
      const r = calcularLayout(pecas, { colunas: c, espacamento: 5 });
      if (!larguraMaxima || r.estatisticas.larguraTotal <= larguraMaxima) {
        sugestoes.push({ colunas: c, ...r.estatisticas });
      }
    }
    res.json({ sugestoes });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
