const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
//  LAYOUT PARA PECAS DE ROUPA (sublimacao)
//
//  - Largura da area = largura do rolo/tecido (ex: 1570mm)
//  - Altura maxima   = comprimento maximo do rolo
//  - Cada coluna tem largura = maior peca da coluna
//  - Pecas ordenadas e empilhadas de baixo para cima
//  - Angulo automatico: testa 0 e 90, usa o que couber na largura
// ─────────────────────────────────────────────────────────────────

function calcularLayout(pecas, config) {
  const {
    espacamento  = 5,
    larguraArea  = 1570,  // largura do tecido em mm
    alturaArea   = 5000,  // altura maxima em mm
    modoAngulo   = 'livre',
    ordenarPor   = 'area'
  } = config;

  if (!pecas || pecas.length === 0)
    return { posicoes: [], estatisticas: { total: 0 } };

  const pecasOrd = ordenarPecas([...pecas], ordenarPor);

  // Colunas: cada coluna tem sua propria largura (= peca mais larga dela)
  // colunas[c] = [ { peca, altAcum, lE, aE, rotacao } ]
  const colunas    = [];
  const altUsada   = [];  // altura acumulada por coluna (mm)
  const largMaxCol = [];  // largura maxima por coluna (mm)

  pecasOrd.forEach(peca => {
    // Melhor rotacao para esta peca
    const rot = melhorRotacao(peca.largura, peca.altura, larguraArea, modoAngulo);
    const { lE, aE } = dimEfetiva(peca.largura, peca.altura, rot);

    // Tentar encaixar em coluna existente
    let colocado = false;
    for (let c = 0; c < colunas.length; c++) {
      const altAtual = altUsada[c];
      const espExtra = altAtual > 0 ? espacamento : 0;
      const novaAlt  = altAtual + espExtra + aE;

      // Verificar se cabe na altura E na largura da coluna
      const novaLarg = Math.max(largMaxCol[c], lE);
      if (novaAlt <= alturaArea + 0.001 && novaLarg <= larguraArea + 0.001) {
        colunas[c].push({ peca, altAcum: altAtual + espExtra, lE, aE, rotacao: rot });
        altUsada[c]   = novaAlt;
        largMaxCol[c] = novaLarg;
        colocado = true;
        break;
      }
    }

    if (!colocado) {
      colunas.push([{ peca, altAcum: 0, lE, aE, rotacao: rot }]);
      altUsada.push(aE);
      largMaxCol.push(lE);
    }
  });

  // Montar posicoes
  // Colunas da ESQUERDA para DIREITA, pecas de BAIXO para CIMA
  // xInicio[c] = posicao X do inicio da coluna c
  const xInicio = [0];
  for (let c = 0; c < colunas.length - 1; c++) {
    xInicio.push(xInicio[c] + largMaxCol[c] + espacamento);
  }

  const posicoes = [];
  colunas.forEach((col, c) => {
    col.forEach(item => {
      const { peca, altAcum, lE, aE, rotacao } = item;
      // Centralizar peca na largura da coluna
      const offsetX = (largMaxCol[c] - lE) / 2;
      posicoes.push({
        id:      peca.id,
        nome:    peca.nome,
        coluna:  c,
        // xRel = distancia do inicio da coluna ate a borda esq da peca
        xRel:    arred(offsetX),
        // yRel = distancia da base da area ate a base da peca (cresce para cima)
        yRel:    arred(altAcum),
        lE:      arred(lE),
        aE:      arred(aE),
        rotacao,
        largColuna: arred(largMaxCol[c])
      });
    });
  });

  const totalLarg = xInicio[xInicio.length - 1] + largMaxCol[largMaxCol.length - 1];
  const totalAlt  = Math.max(...altUsada);
  const areaPecas = pecas.reduce((s, p) => s + p.largura * p.altura, 0);

  return {
    posicoes,
    xInicioColuna: xInicio,
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
  const cabem = angulos.filter(a => dimEfetiva(larg, alt, a).lE <= larguraMax + 0.001);
  const lista  = cabem.length > 0 ? cabem : angulos;
  return lista.reduce((best, a) => {
    return dimEfetiva(larg, alt, a).aE < dimEfetiva(larg, alt, best).aE ? a : best;
  }, lista[0]);
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
    case 'area':    return pecas.sort((a, b) => b.largura*b.altura - a.largura*a.altura);
    case 'largura': return pecas.sort((a, b) => b.largura - a.largura);
    case 'altura':  return pecas.sort((a, b) => b.altura  - a.altura);
    case 'nome':    return pecas.sort((a, b) => (a.nome||'').localeCompare(b.nome||''));
    default:        return pecas;
  }
}

function arred(n) { return Math.round(n * 1000) / 1000; }

app.get('/health', (req, res) => res.json({ status: 'ok', versao: '11.0.0' }));

app.post('/calcular', (req, res) => {
  try {
    const { pecas, config } = req.body;
    if (!Array.isArray(pecas) || pecas.length === 0)
      return res.status(400).json({ erro: 'Envie ao menos uma peca.' });
    for (const p of pecas) {
      if (!p.id)      return res.status(400).json({ erro: 'Peca sem id.' });
      if (!p.largura) return res.status(400).json({ erro: `Peca ${p.id} sem largura.` });
      if (!p.altura)  return res.status(400).json({ erro: `Peca ${p.id} sem altura.` });
    }
    res.json(calcularLayout(pecas, config || {}));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor v11.0.0 porta ${PORT}`));
