const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
//  REGRAS DE LAYOUT
//
//  - Área definida por larguraColuna x alturaMaxima (em mm)
//  - Origem: canto inferior direito da área
//  - Peças empilhadas de baixo para cima dentro de cada coluna
//  - Colunas abertas da direita para a esquerda
//  - Peças alinhadas pela base (Y cresce para cima)
//  - Angulo:
//      "livre"  → testa 0° e 90°, usa o que couber melhor na largura
//      "90"     → aceita 0° e 90°
//      "180"    → aceita 0°, 90° e 180°
//      "0"      → sem rotação
// ─────────────────────────────────────────────────────────────────

function calcularLayout(pecas, config) {
  const {
    espacamento  = 5,
    larguraArea  = 157,   // largura total da área de trabalho
    alturaArea   = 500,   // altura total da área de trabalho
    modoAngulo   = 'livre', // 'livre' | '90' | '180' | '0'
    ordenarPor   = 'area'
  } = config;

  if (!pecas || pecas.length === 0)
    return { posicoes: [], estatisticas: { total: 0 } };

  // 1. Ordenar
  const pecasOrd = ordenarPecas([...pecas], ordenarPor);

  // 2. Distribuir em colunas (cada coluna tem largura = larguraArea)
  //    Dentro de cada coluna, peças empilhadas de baixo para cima.
  //    colunas[c] = [ { peca, yBase, largEfetiva, altEfetiva, rotacao } ]
  //    yBase = distância do fundo da área até a base da peça

  const colunas     = [];   // lista de colunas
  const altUsada    = [];   // altura acumulada em cada coluna

  pecasOrd.forEach(peca => {
    // Determina a melhor rotação para esta peça nesta largura
    const rot = melhorRotacao(peca.largura, peca.altura, larguraArea, modoAngulo);
    const { lE, aE } = dimEfetiva(peca.largura, peca.altura, rot);

    // Tenta colocar na última coluna aberta
    let colocado = false;
    for (let c = 0; c < colunas.length; c++) {
      const usado = altUsada[c];
      const extra = usado > 0 ? espacamento : 0;
      if (usado + extra + aE <= alturaArea + 0.001) {
        const yBase = usado + extra;
        colunas[c].push({ peca, yBase, lE, aE, rotacao: rot });
        altUsada[c] = yBase + aE;
        colocado = true;
        break;
      }
    }

    if (!colocado) {
      // Nova coluna
      colunas.push([{ peca, yBase: 0, lE, aE, rotacao: rot }]);
      altUsada.push(aE);
    }
  });

  // 3. Calcular X de cada coluna
  //    Origem = borda direita da área. Colunas crescem para a ESQUERDA.
  //    xDireita[c] = posição da borda direita da coluna c (em mm, ref. 0 = esquerda)
  //    Coluna 0 (primeira): borda direita = larguraArea
  //    Coluna 1: borda direita = larguraArea - larguraArea - espacamento = ...
  //    Ou seja: xEsquerda[c] = (larguraArea + espacamento) * c  (contando da direita)

  const posicoes = [];

  colunas.forEach((col, c) => {
    // xEsquerda do retângulo da coluna, contado da ESQUERDA do documento
    // Coluna 0 = mais à direita, coluna 1 = à esquerda dela, etc.
    const xEsqColuna = larguraArea - (c + 1) * larguraArea - c * espacamento;
    // Simplificando: coluna 0 começa em 0, coluna 1 em -(larguraArea+esp), etc.
    // Mas queremos coordenadas positivas relativas à origem do documento,
    // então deixamos o VBA fazer a inversão. Aqui retornamos:
    //   x = posição da borda ESQUERDA da peça (centralizada na coluna)
    //   y = posição da borda INFERIOR da peça
    // O VBA aplica: xCorel = origemX - (c+1)*larguraArea - c*esp + offsetCentraliza
    //               yCorel = origemY - yBase - altePeca  (contando de baixo)

    col.forEach(item => {
      const { peca, yBase, lE, aE, rotacao } = item;
      // Centralizar horizontalmente dentro da coluna
      const offsetX = (larguraArea - lE) / 2;

      posicoes.push({
        id:       peca.id,
        nome:     peca.nome || peca.id,
        // xCol: deslocamento a partir da borda esquerda desta coluna
        xCol:     arred(offsetX),
        // yBase: distância da base da área até a base da peça
        yBase:    arred(yBase),
        // dimensões efetivas
        lE:       arred(lE),
        aE:       arred(aE),
        rotacao:  rotacao,
        coluna:   c,
        // largura e altura originais
        largura:  peca.largura,
        altura:   peca.altura
      });
    });
  });

  // 4. Estatísticas
  const totalColunas = colunas.length;
  const largTotal    = totalColunas * larguraArea + Math.max(0, totalColunas - 1) * espacamento;
  const altTotal     = Math.max(...altUsada, 0);
  const areaPecas    = pecas.reduce((s, p) => s + p.largura * p.altura, 0);
  const areaTotal    = largTotal * altTotal || 1;

  return {
    posicoes,
    config: { larguraArea, alturaArea, espacamento, totalColunas },
    estatisticas: {
      total:          pecas.length,
      colunas:        totalColunas,
      larguraTotal:   arred(largTotal),
      alturaTotal:    arred(altTotal),
      aproveitamento: arred(areaPecas / areaTotal * 100) + '%'
    }
  };
}

// Determina a melhor rotação para caber na largura da coluna
function melhorRotacao(larg, alt, larguraCol, modo) {
  const angulos = anglosPermitidos(modo);

  // Filtra ângulos onde a peça cabe na largura
  const cabeEm = angulos.filter(a => {
    const { lE } = dimEfetiva(larg, alt, a);
    return lE <= larguraCol + 0.001;
  });

  if (cabeEm.length === 0) {
    // Nenhum cabe — usa o que tem menor largura efetiva
    return angulos.reduce((best, a) => {
      const { lE: lBest } = dimEfetiva(larg, alt, best);
      const { lE: lA    } = dimEfetiva(larg, alt, a);
      return lA < lBest ? a : best;
    }, angulos[0]);
  }

  // Entre os que cabem, escolhe o que ocupa menos altura (maior aproveitamento vertical)
  return cabeEm.reduce((best, a) => {
    const { aE: aBest } = dimEfetiva(larg, alt, best);
    const { aE: aA    } = dimEfetiva(larg, alt, a);
    return aA < aBest ? a : best;
  }, cabeEm[0]);
}

function anglosPermitidos(modo) {
  switch (modo) {
    case '0':    return [0];
    case '90':   return [0, 90];
    case '180':  return [0, 90, 180];
    case 'livre':
    default:     return [0, 90];
  }
}

function dimEfetiva(larg, alt, angulo) {
  const a = ((angulo % 360) + 360) % 360;
  if (a === 0 || a === 180) return { lE: larg, aE: alt };
  if (a === 90 || a === 270) return { lE: alt,  aE: larg };
  const rad = a * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { lE: larg * cos + alt * sin, aE: larg * sin + alt * cos };
}

function ordenarPecas(pecas, criterio) {
  switch (criterio) {
    case 'area':    return pecas.sort((a, b) => (b.largura*b.altura)-(a.largura*a.altura));
    case 'largura': return pecas.sort((a, b) => b.largura - a.largura);
    case 'altura':  return pecas.sort((a, b) => b.altura  - a.altura);
    case 'nome':    return pecas.sort((a, b) => (a.nome||'').localeCompare(b.nome||''));
    default:        return pecas;
  }
}

function arred(n) { return Math.round(n * 1000) / 1000; }

// ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', versao: '5.0.0', hora: new Date().toISOString() });
});

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
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor v5.0.0 porta ${PORT}`));
