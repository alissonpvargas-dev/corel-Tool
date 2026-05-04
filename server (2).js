const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
//  LAYOUT PARA PECAS DE ROUPA - SUBLIMACAO
//  Todas as dimensoes em MM
//  Pecas empilhadas de baixo para cima
//  Colunas da esquerda para direita
// ─────────────────────────────────────────────────────────────────

function calcularLayout(pecas, config) {
  const {
    espacamento = 5,
    larguraArea = 1570,
    alturaArea  = 5000,
    modoAngulo  = 'livre',
    ordenarPor  = 'area'
  } = config;

  if (!pecas || pecas.length === 0)
    return { posicoes: [], xInicioColuna: [], estatisticas: { total: 0 } };

  console.log(`Calculando ${pecas.length} pecas. Primeira: ${JSON.stringify(pecas[0])}`);

  const pecasOrd = ordenarPecas([...pecas], ordenarPor);

  const colunas    = [];
  const altUsada   = [];
  const largMaxCol = [];

  pecasOrd.forEach(peca => {
    const rot = melhorRotacao(peca.largura, peca.altura, larguraArea, modoAngulo);
    const { lE, aE } = dimEfetiva(peca.largura, peca.altura, rot);

    let colocado = false;
    for (let c = 0; c < colunas.length; c++) {
      const altAtual = altUsada[c];
      const espExtra = altAtual > 0 ? espacamento : 0;
      const novaAlt  = altAtual + espExtra + aE;
      const novaLarg = Math.max(largMaxCol[c], lE);

      if (novaAlt <= alturaArea + 0.001 && novaLarg <= larguraArea + 0.001) {
        colunas[c].push({ peca, yRel: altAtual + espExtra, lE, aE, rotacao: rot });
        altUsada[c]   = novaAlt;
        largMaxCol[c] = novaLarg;
        colocado = true;
        break;
      }
    }

    if (!colocado) {
      colunas.push([{ peca, yRel: 0, lE, aE, rotacao: rot }]);
      altUsada.push(aE);
      largMaxCol.push(lE);
    }
  });

  // Calcular X de inicio de cada coluna
  const xInicioColuna = [0];
  for (let c = 0; c < colunas.length - 1; c++) {
    xInicioColuna.push(arred(xInicioColuna[c] + largMaxCol[c] + espacamento));
  }

  // Montar posicoes
  const posicoes = [];
  colunas.forEach((col, c) => {
    col.forEach(item => {
      const { peca, yRel, lE, aE, rotacao } = item;
      const offsetX = (largMaxCol[c] - lE) / 2;
      posicoes.push({
        id:      peca.id,
        nome:    peca.nome,
        coluna:  c,
        xRel:    arred(offsetX),  // offset dentro da coluna (mm)
        yRel:    arred(yRel),     // distancia da base ate a base da peca (mm)
        lE:      arred(lE),       // largura efetiva (mm)
        aE:      arred(aE),       // altura efetiva (mm)
        rotacao
      });
    });
  });

  const totalLarg = xInicioColuna[xInicioColuna.length - 1] + largMaxCol[largMaxCol.length - 1];
  const totalAlt  = Math.max(...altUsada);
  const areaPecas = pecas.reduce((s, p) => s + p.largura * p.altura, 0);

  return {
    posicoes,
    xInicioColuna,
    estatisticas: {
      total:          pecas.length,
      colunas:        colunas.length,
      larguraTotal:   arred(totalLarg),
      alturaTotal:    arred(totalAlt),
      aproveitamento: arred(areaPecas / (totalLarg * totalAlt) * 100) + '%'
    }
  };
}

function melhorRotacao(larg, alt, larguraMax, modo) {
  const angulos = anglosPermitidos(modo);
  const cabem   = angulos.filter(a => dimEfetiva(larg, alt, a).lE <= larguraMax + 0.001);
  const lista   = cabem.length > 0 ? cabem : angulos;
  return lista.reduce((best, a) =>
    dimEfetiva(larg, alt, a).aE < dimEfetiva(larg, alt, best).aE ? a : best
  , lista[0]);
}

function anglosPermitidos(modo) {
  switch (modo) {
    case '0':   return [0];
    case '90':  return [0, 90];
    case '180': return [0, 90, 180];
    default:    return [0, 90];
  }
}

function dimEfetiva(larg, alt, angulo) {
  const a = ((angulo % 360) + 360) % 360;
  if (a === 0 || a === 180) return { lE: larg, aE: alt };
  if (a === 90 || a === 270) return { lE: alt, aE: larg };
  const rad = a * Math.PI / 180;
  return {
    lE: larg * Math.abs(Math.cos(rad)) + alt * Math.abs(Math.sin(rad)),
    aE: larg * Math.abs(Math.sin(rad)) + alt * Math.abs(Math.cos(rad))
  };
}

function ordenarPecas(pecas, criterio) {
  switch (criterio) {
    case 'area':    return pecas.sort((a, b) => b.largura * b.altura - a.largura * a.altura);
    case 'largura': return pecas.sort((a, b) => b.largura - a.largura);
    case 'altura':  return pecas.sort((a, b) => b.altura  - a.altura);
    case 'nome':    return pecas.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    default:        return pecas;
  }
}

function arred(n) { return Math.round(n * 1000) / 1000; }

app.get('/health', (req, res) => res.json({ status: 'ok', versao: '12.0.0' }));

app.post('/calcular', (req, res) => {
  try {
    const { pecas, config } = req.body;
    if (!Array.isArray(pecas) || pecas.length === 0)
      return res.status(400).json({ erro: 'Envie ao menos uma peca.' });
    for (const p of pecas) {
      if (!p.id)           return res.status(400).json({ erro: 'Peca sem id.' });
      if (p.largura == null) return res.status(400).json({ erro: `Peca ${p.id} sem largura.` });
      if (p.altura == null)  return res.status(400).json({ erro: `Peca ${p.id} sem altura.` });
    }
    const resultado = calcularLayout(pecas, config || {});
    console.log(`Resultado: ${resultado.estatisticas.colunas} colunas, largura ${resultado.estatisticas.larguraTotal}mm`);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor v12.0.0 porta ${PORT}`));
