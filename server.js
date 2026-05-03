const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  ALGORITMO DE ENCAIXE COM CAIXA LIMITANTE
// ─────────────────────────────────────────────

/**
 * Organiza pecas em colunas com largura e altura maximas.
 * Quando a altura da coluna e atingida, abre uma nova coluna.
 *
 * config: {
 *   espacamento:    5,    // mm entre pecas
 *   larguraColuna:  157,  // mm - largura de cada coluna
 *   alturaMaxima:   500,  // mm - altura maxima antes de nova coluna
 *   angulo:         0,    // graus aplicado a todas as pecas
 *   origemX:        0,    // ponto de inicio X
 *   origemY:        0,    // ponto de inicio Y
 *   ordenarPor:     "area" // "area"|"largura"|"altura"|"nome"|"original"
 * }
 */
function calcularLayout(pecas, config) {
  const {
    espacamento   = 5,
    larguraColuna = 157,
    alturaMaxima  = 500,
    angulo        = 0,
    origemX       = 0,
    origemY       = 0,
    ordenarPor    = 'area'
  } = config;

  if (!pecas || pecas.length === 0) {
    return { posicoes: [], estatisticas: { total: 0 } };
  }

  // 1. Ordenar pecas
  const pecasOrdenadas = ordenarPecas([...pecas], ordenarPor);

  // 2. Distribuir pecas em colunas respeitando alturaMaxima
  // colunas[c] = array de { peca, yLocal, larguraEfetiva, alturaEfetiva }
  const colunas      = [];
  const alturasCol   = [];
  const largurasCol  = [];

  pecasOrdenadas.forEach(peca => {
    const { larguraEfetiva, alturaEfetiva } = dimensoesRotacionadas(
      peca.largura, peca.altura, angulo + (peca.anguloExtra || 0)
    );

    // Procura primeira coluna onde a peca cabe
    let colocado = false;
    for (let c = 0; c < colunas.length; c++) {
      const altAtual  = alturasCol[c];
      const espacoExtra = altAtual > 0 ? espacamento : 0;
      const novaAltura  = altAtual + espacoExtra + alturaEfetiva;

      if (novaAltura <= alturaMaxima + 0.001) {
        const yLocal = altAtual + espacoExtra;
        colunas[c].push({ peca, yLocal, larguraEfetiva, alturaEfetiva });
        alturasCol[c]  = novaAltura;
        largurasCol[c] = Math.max(largurasCol[c], larguraEfetiva);
        colocado = true;
        break;
      }
    }

    // Nao coube: abre nova coluna
    if (!colocado) {
      colunas.push([{ peca, yLocal: 0, larguraEfetiva, alturaEfetiva }]);
      alturasCol.push(alturaEfetiva);
      largurasCol.push(larguraEfetiva);
    }
  });

  // 3. Calcular X de inicio de cada coluna
  const xColunas = [origemX];
  for (let c = 0; c < colunas.length - 1; c++) {
    xColunas.push(xColunas[c] + larguraColuna + espacamento);
  }

  // 4. Montar resultado
  const posicoes = [];
  colunas.forEach((col, c) => {
    col.forEach(({ peca, yLocal, larguraEfetiva }) => {
      const anguloFinal = angulo + (peca.anguloExtra || 0);
      // Centralizar peca dentro da largura da coluna
      const offsetX = (larguraColuna - larguraEfetiva) / 2;

      posicoes.push({
        id:      peca.id,
        nome:    peca.nome || peca.id,
        x:       arredondar(xColunas[c] + Math.max(0, offsetX)),
        y:       arredondar(origemY + yLocal),
        largura: peca.largura,
        altura:  peca.altura,
        rotacao: anguloFinal,
        coluna:  c
      });
    });
  });

  // 5. Estatisticas
  const totalLargura = colunas.length > 0
    ? xColunas[xColunas.length - 1] + larguraColuna
    : 0;
  const totalAltura  = Math.max(...alturasCol, 0);
  const areaPecas    = pecas.reduce((s, p) => s + p.largura * p.altura, 0);
  const areaTotal    = totalLargura * totalAltura || 1;

  return {
    posicoes,
    estatisticas: {
      total:          pecas.length,
      colunas:        colunas.length,
      larguraTotal:   arredondar(totalLargura),
      alturaTotal:    arredondar(totalAltura),
      aproveitamento: arredondar((areaPecas / areaTotal) * 100) + '%'
    }
  };
}

function ordenarPecas(pecas, criterio) {
  switch (criterio) {
    case 'area':    return pecas.sort((a, b) => (b.largura * b.altura) - (a.largura * a.altura));
    case 'largura': return pecas.sort((a, b) => b.largura - a.largura);
    case 'altura':  return pecas.sort((a, b) => b.altura  - a.altura);
    case 'nome':    return pecas.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    default:        return pecas;
  }
}

function dimensoesRotacionadas(largura, altura, angulo) {
  const a = ((angulo % 360) + 360) % 360;
  if (a === 0 || a === 180) return { larguraEfetiva: largura, alturaEfetiva: altura };
  if (a === 90 || a === 270) return { larguraEfetiva: altura, alturaEfetiva: largura };
  const rad = (a * Math.PI) / 180;
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', versao: '2.0.0', hora: new Date().toISOString() });
});

app.post('/calcular', (req, res) => {
  try {
    const { pecas, config } = req.body;

    if (!Array.isArray(pecas) || pecas.length === 0)
      return res.status(400).json({ erro: 'Envie ao menos uma peca em "pecas".' });

    for (const p of pecas) {
      if (!p.id)      return res.status(400).json({ erro: 'Peca sem "id".' });
      if (!p.largura) return res.status(400).json({ erro: `Peca "${p.id}" sem "largura".` });
      if (!p.altura)  return res.status(400).json({ erro: `Peca "${p.id}" sem "altura".` });
    }

    res.json(calcularLayout(pecas, config || {}));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor v2.0.0 rodando na porta ${PORT}`));
