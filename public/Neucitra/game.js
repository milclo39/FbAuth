(() => {
  const COLS = 5, ROWS = 8, SIZE = COLS * ROWS;
  const CAT_SPAWN_CHANCE = 0.06;
  const SAVE_KEY = 'eto-link-game-v1';
  const animals = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const hues = [345, 28, 48, 76, 145, 188, 215, 255, 280, 315, 8, 110];
  const board = document.querySelector('#board');
  const boardWrap = document.querySelector('#board-wrap');
  const line = document.querySelector('#path-line');
  const animationLayer = document.querySelector('#animation-layer');
  const scoreEl = document.querySelector('#score'), highestEl = document.querySelector('#highest'), lapEl = document.querySelector('#lap');
  const hint = document.querySelector('#hint'), swapButton = document.querySelector('#swap'), swapCount = document.querySelector('#swap-count');
  const gameOver = document.querySelector('#game-over'), finalScore = document.querySelector('#final-score');
  const preview = document.querySelector('#preview');
  const bgm = document.querySelector('#bgm'), muteButton = document.querySelector('#mute');
  const helpPopup = document.querySelector('#help-popup'), recordPopup = document.querySelector('#record-popup');
  let cells, score, maxReached, swaps, selected, dragging, swapMode, swapFirst, ended, animating = false, animationSerial = 0, audioUnlocked = false, recordResolver = null;

  const value = exp => 2 ** (exp % 12);
  const formatValue = exp => value(exp).toLocaleString('ja-JP');
  const lap = exp => Math.floor(exp / 12) + 1;
  const lowerBound = () => Math.max(0, maxReached - 9);
  const randomExp = () => lowerBound() + Math.floor(Math.random() * Math.min(6, maxReached - lowerBound() + 1));
  const indexOf = (row, col) => row * COLS + col;
  const rcOf = idx => [Math.floor(idx / COLS), idx % COLS];
  const adjacent = (a,b) => { const [ar,ac]=rcOf(a),[br,bc]=rcOf(b); return Math.max(Math.abs(ar-br),Math.abs(ac-bc)) === 1; };
  const isCat = cell => typeof cell === 'object' && cell !== null && cell.type === 'cat';
  const catForCurrentLap = () => ({ type:'cat', armor: maxReached >= 84 ? 2 : maxReached >= 36 ? 1 : 0 });
  function randomPanel() {
    if (maxReached >= 12 && Math.random() < CAT_SPAWN_CHANCE) return catForCurrentLap();
    return randomExp();
  }

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, cells, score, maxReached, swaps }));
    } catch {
      // 保存が許可されていない環境でもゲーム自体は続けられる。
      setHint('保存できません。ブラウザの保存設定をご確認ください');
    }
  }
  function loadGame() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved || saved.version !== 1 || !Array.isArray(saved.cells) || saved.cells.length !== SIZE ||
          !Number.isSafeInteger(saved.maxReached) || saved.maxReached < 5 ||
          !Number.isSafeInteger(saved.score) || saved.score < 0 ||
          ![0, 1].includes(saved.swaps)) return false;
      const min = Math.max(0, saved.maxReached - 9);
      if (!saved.cells.every(cell => Number.isSafeInteger(cell) ? cell >= min && cell <= saved.maxReached :
        isCat(cell) && Number.isInteger(cell.armor) && cell.armor >= 0 && cell.armor <= 2)) return false;
      cells = saved.cells;
      score = saved.score;
      maxReached = saved.maxReached;
      swaps = saved.swaps;
      selected = []; dragging = false; swapMode = false; swapFirst = null; ended = false; animating = false;
      gameOver.hidden = true;
      render(); updateStatus(); setHint('前回のつづきから再開しました');
      checkGameOver();
      return true;
    } catch {
      return false;
    }
  }

  function updateMuteButton() {
    muteButton.textContent = bgm.muted ? '🔇' : '♫';
    muteButton.setAttribute('aria-label', bgm.muted ? '音楽のミュートを解除' : '音楽をミュート');
  }
  function saveMuteSetting() { try { localStorage.setItem('eto-link-muted', String(bgm.muted)); } catch {} }
  async function activateMusic() {
    audioUnlocked = true;
    if (document.hidden || bgm.muted) return;
    try { await bgm.play(); } catch { /* ブラウザの再生制限中は次のユーザー操作で再試行 */ }
  }
  bgm.volume = 0.36;
  try { bgm.muted = localStorage.getItem('eto-link-muted') === 'true'; } catch { bgm.muted = false; }
  updateMuteButton();
  document.addEventListener('pointerdown', activateMusic, { once:true });
  document.addEventListener('keydown', activateMusic, { once:true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) bgm.pause();
    else if (audioUnlocked) void activateMusic();
  });
  window.addEventListener('focus', () => { if (audioUnlocked) void activateMusic(); });
  muteButton.addEventListener('click', () => {
    bgm.muted = !bgm.muted;
    updateMuteButton(); saveMuteSetting();
    if (audioUnlocked && !bgm.muted && !document.hidden) void activateMusic();
  });

  function init() {
    animationSerial++;
    animationLayer.replaceChildren();
    recordPopup.hidden = true;
    if (recordResolver) { recordResolver(); recordResolver = null; }
    score = 0; maxReached = 5; swaps = 1; selected = []; dragging = false; swapMode = false; swapFirst = null; ended = false; animating = false;
    do { cells = Array.from({length: SIZE}, randomExp); } while (!hasConnectablePair());
    gameOver.hidden = true;
    render(); updateStatus(); setHint('同じ干支を2枚以上なぞってつなごう'); saveGame();
  }
  function render() {
    board.innerHTML = cells.map((cell, i) => {
      const cat = isCat(cell);
      const exp = cat ? null : cell;
      const selectedClass = selected.includes(i) ? ' selected' : '';
      const swapClass = swapMode && swapFirst === i ? ' swap-choice' : '';
      const maxClass = !cat && exp === maxReached ? ' max-tile' : '';
      if (cat) return `<button class="tile cat-tile${selectedClass}${swapClass}" data-index="${i}" aria-label="ネコパネル${cell.armor ? `、耐久プラス${cell.armor}` : ''}"><img draggable="false" src="eto/ex1.png" alt="ネコ"><span class="value cat-label">ネコ</span>${cell.armor ? `<i class="cat-armor">${'+'.repeat(cell.armor)}</i>` : ''}</button>`;
      const lapClass = lap(exp) % 2 === 0 ? ' lap-black' : ' lap-red';
      return `<button class="tile${selectedClass}${swapClass}${maxClass}" data-index="${i}" style="--hue:${hues[exp % 12]}" aria-label="${formatValue(exp)}・${animals[exp % 12]}${exp === maxReached ? '、最高段階' : ''}"><img draggable="false" src="eto/${exp % 12 + 1}.png" alt="${animals[exp % 12]}"><span class="value">${formatValue(exp)}</span>${lap(exp) > 1 ? `<i class="lap-dot${lapClass}" aria-label="${lap(exp)}周目"></i>` : ''}${exp === maxReached ? '<span class="best-crown" aria-hidden="true">👑</span>' : ''}</button>`;
    }).join('');
    drawPath();
    updatePreview();
  }
  function updatePreview() {
    if (selected.length < 2 || cells[selected[0]] !== cells[selected[1]]) { preview.hidden = true; preview.innerHTML = ''; return; }
    const result = mergedExponent(selected.map(index => cells[index]));
    preview.innerHTML = `<img src="eto/${result % 12 + 1}.png" alt="${animals[result % 12]}"><strong>${formatValue(result)}</strong>`;
    preview.title = `このまま合体すると ${formatValue(result)}・${animals[result % 12]}（${lap(result)}周目）`;
    preview.setAttribute('aria-label', preview.title);
    preview.hidden = false;
  }
  function updateStatus() {
    scoreEl.textContent = score.toLocaleString('ja-JP');
    highestEl.textContent = formatValue(maxReached);
    lapEl.textContent = `${lap(maxReached)}周目・${animals[maxReached % 12]}`;
    swapCount.textContent = swaps ? 'あと 1 回' : '使い切りました';
    swapButton.disabled = !swaps || ended;
    swapButton.classList.toggle('active', swapMode);
    swapButton.setAttribute('aria-pressed', String(swapMode));
  }
  function setHint(text) { hint.textContent = text; }
  function drawPath() {
    const rect = board.getBoundingClientRect();
    const points = selected.map(i => { const r=board.children[i].getBoundingClientRect(); return `${r.left-rect.left+r.width/2},${r.top-rect.top+r.height/2}`; });
    line.innerHTML = points.length > 1 ? `<polyline points="${points.join(' ')}"></polyline>` : '';
  }
  function tileAtPoint(x,y) {
    const target = document.elementFromPoint(x,y);
    const tile = target && target.closest('.tile');
    return tile && board.contains(tile) ? Number(tile.dataset.index) : null;
  }
  function canAppend(idx) {
    if (!selected.length) return true;
    if (selected.includes(idx) || !adjacent(selected.at(-1),idx)) return false;
    if (isCat(cells[idx])) return false;
    const base = cells[selected[0]];
    // 最初の2枚は同じ段階。その後は直前と同じ段階、または1段階上をたどれる。
    if (selected.length < 2) return cells[idx] === base;
    const previous = cells[selected.at(-1)];
    return cells[idx] === previous || cells[idx] === previous + 1;
  }
  function startDrag(idx) { selected = [idx]; dragging = true; render(); setHint('同じパネルをもう1枚つなげてください'); }
  function extendDrag(idx) {
    if (idx === null) return;
    // 直前のパネルへ戻ったら、最後に追加した1枚を経路から外して分岐できるようにする。
    if (selected.length > 1 && idx === selected[selected.length - 2]) {
      selected.pop();
      render();
      setHint(selected.length < 2 ? '同じパネルをもう1枚つなげてください' : '1手戻しました。同じ段階か1段階上を選べます');
      return;
    }
    if (!canAppend(idx)) return;
    selected.push(idx); render();
    setHint(selected.length < 2 ? '同じパネルをもう1枚つなげてください' : '同じ段階か、1段階上を続けてつなげられます');
  }
  function endDrag() {
    if (!dragging) return;
    dragging=false;
    if (selected.length >= 2 && cells[selected[0]] === cells[selected[1]]) { preview.hidden = true; void merge(); }
    else { selected=[]; render(); setHint('同じ干支を2枚以上なぞってつなごう'); }
  }
  function mergedExponent(exps) {
    const high = Math.max(...exps);
    const scaled = exps.reduce((sum, exp) => sum + 2 ** (exp - high), 0);
    return high + Math.ceil(Math.log2(scaled));
  }
  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  function rectInAnimationLayer(element, layerRect = animationLayer.getBoundingClientRect()) {
    const rect = element.getBoundingClientRect();
    return { left: rect.left - layerRect.left, top: rect.top - layerRect.top, width: rect.width, height: rect.height };
  }
  function createFlyingTile(source, position) {
    const ghost = source.cloneNode(true);
    ghost.disabled = true;
    ghost.classList.remove('selected', 'swap-choice', 'merging-source');
    ghost.classList.add('flying-tile');
    Object.assign(ghost.style, { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, height: `${position.height}px`, opacity: '1' });
    animationLayer.append(ghost);
    return ghost;
  }
  function spawnMergeBurst(index) {
    const tile = board.children[index];
    if (!tile) return;
    const {left,top,width,height} = rectInAnimationLayer(tile);
    const x = left + width / 2, y = top + height / 2;
    const particles = [];
    const glow = document.createElement('span');
    glow.className = 'burst-glow'; glow.style.left = `${x}px`; glow.style.top = `${y}px`;
    animationLayer.append(glow); particles.push(glow);
    for (let i=0; i<10; i++) {
      const angle = (Math.PI * 2 * i / 10) + (Math.random() * .22);
      const radius = 34 + Math.random() * 26;
      const star = document.createElement('span');
      star.className = 'burst-star'; star.textContent = i % 3 === 0 ? '✦' : '★';
      star.style.left = `${x}px`; star.style.top = `${y}px`;
      star.style.setProperty('--dx', `${Math.cos(angle) * radius}px`);
      star.style.setProperty('--dy', `${Math.sin(angle) * radius}px`);
      animationLayer.append(star); particles.push(star);
    }
    for (let i=0; i<8; i++) {
      const flare = document.createElement('i');
      flare.className = 'burst-flare'; flare.style.left = `${x}px`; flare.style.top = `${y}px`;
      flare.style.setProperty('--angle', `${i * 45}deg`); animationLayer.append(flare); particles.push(flare);
    }
    window.setTimeout(() => particles.forEach(node => node.remove()), 900);
  }
  function groupPanelCounts(exponents) {
    const counts = new Map();
    exponents.forEach(exp => counts.set(exp, (counts.get(exp) || 0) + 1));
    return [...counts.entries()].sort((a,b) => a[0] - b[0]);
  }
  function showRecordPopup(exp, removedGroups) {
    const created = document.querySelector('#record-created');
    const removed = document.querySelector('#record-removed');
    created.innerHTML = `<img src="eto/${exp % 12 + 1}.png" alt="${animals[exp % 12]}"><strong>${formatValue(exp)}・${animals[exp % 12]}</strong><span>${lap(exp)}周目の最高段階！</span>`;
    if (removedGroups.length) {
      removed.hidden = false;
      removed.innerHTML = `盤面の下位パネルが消滅しました<div class="removed-list">${removedGroups.map(([level,count]) => `<span class="removed-item"><img src="eto/${level % 12 + 1}.png" alt="${animals[level % 12]}"><b>${formatValue(level)} ×${count}</b></span>`).join('')}</div>`;
    } else {
      removed.hidden = false;
      removed.textContent = '今回は消滅する下位パネルはありません';
    }
    recordPopup.hidden = false;
    return new Promise(resolve => { recordResolver = resolve; });
  }
  function closeRecordPopup() {
    recordPopup.hidden = true;
    if (recordResolver) { const resolve = recordResolver; recordResolver = null; resolve(); }
  }
  async function playMergeAnimation(path, serial) {
    const ghosts = path.slice(0, -1).map((index, order) => {
      const source = board.children[index];
      const next = board.children[path[order + 1]];
      const start = rectInAnimationLayer(source);
      const target = rectInAnimationLayer(next);
      source.classList.add('merging-source');
      const ghost = createFlyingTile(source, start);
      ghost.style.transitionDuration = '260ms';
      ghost.style.transitionDelay = `${order * 115}ms`;
      return { ghost, dx: target.left - start.left, dy: target.top - start.top };
    });
    // 初期位置を一度レイアウトに反映してから移動させ、CSS transition を確実に発火させる。
    ghosts.forEach(({ghost}) => void ghost.offsetWidth);
    await new Promise(requestAnimationFrame);
    if (serial !== animationSerial) return false;
    ghosts.forEach(({ghost, dx, dy}) => { ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.88)`; ghost.style.opacity = '.14'; });
    await wait(Math.max(260, (ghosts.length - 1) * 115 + 280));
    if (serial !== animationSerial) return false;
    animationLayer.replaceChildren();
    return true;
  }
  async function playFallAnimation(movements, previousRects, serial) {
    const falling = movements.filter(move => move.from === null || move.from !== move.to);
    if (!falling.length) return true;
    const rowGap = parseFloat(getComputedStyle(board).rowGap) || 0;
    const ghosts = falling.map(move => {
      const targetTile = board.children[move.to];
      const target = rectInAnimationLayer(targetTile);
      const start = move.from === null
        ? { ...target, top: -target.height - (Math.floor(move.to / COLS) * (target.height + rowGap)) }
        : previousRects[move.from];
      const ghost = createFlyingTile(targetTile, start);
      targetTile.style.opacity = '0';
      const distance = Math.abs(target.top - start.top);
      ghost.style.transitionDuration = `${Math.min(620, 220 + distance * .7)}ms`;
      return { ghost, dx: target.left - start.left, dy: target.top - start.top };
    });
    // 盤面上の最終タイルを隠してから、同じ絵柄の複製を開始位置に固定する。
    ghosts.forEach(({ghost}) => void ghost.offsetWidth);
    await new Promise(requestAnimationFrame);
    if (serial !== animationSerial) return false;
    ghosts.forEach(({ghost, dx, dy}) => { ghost.style.transform = `translate(${dx}px, ${dy}px)`; });
    await wait(650);
    if (serial !== animationSerial) return false;
    animationLayer.replaceChildren();
    board.querySelectorAll('.tile').forEach(tile => tile.style.opacity = '');
    return true;
  }
  async function merge() {
    const path = [...selected], exps = path.map(i => cells[i]);
    const result = mergedExponent(exps), endpoint = path.at(-1);
    const serial = ++animationSerial;
    animating = true;
    if (!await playMergeAnimation(path, serial) || serial !== animationSerial) return;
    const previousRects = Array.from(board.children, tile => rectInAnimationLayer(tile));
    const previousWindowLower = lowerBound();
    path.forEach(i => cells[i] = null);
    cells[endpoint] = result;
    const madeNewMaximum = result > maxReached;
    maxReached = Math.max(maxReached, result);
    const removedGroups = madeNewMaximum ? groupPanelCounts(cells.filter(exp => typeof exp === 'number' && exp < lowerBound())) : [];
    score += (result + 1) * path.length * 10;
    if (madeNewMaximum) swaps = 1;
    const movements = settleBoard(path, previousWindowLower);
    saveGame();
    selected=[]; render(); updateStatus();
    setHint(`${path.length}枚を合体！ ${formatValue(result)}・${animals[result % 12]}ができました`);
    if (!await playFallAnimation(movements, previousRects, serial) || serial !== animationSerial) return;
    const finalEndpoint = movements.find(move => move.from === endpoint)?.to ?? endpoint;
    spawnMergeBurst(finalEndpoint);
    if (madeNewMaximum) { await wait(420); await showRecordPopup(result, removedGroups); }
    animating = false;
    checkGameOver();
  }
  function settleBoard(mergedIndices, previousWindowLower) {
    const min = lowerBound();
    const removedIndices = new Set(mergedIndices);
    cells.forEach((cell, index) => { if (typeof cell === 'number' && cell < min) removedIndices.add(index); });
    const windowAdvanced = min > previousWindowLower;
    if (windowAdvanced) {
      cells = cells.map(cell => isCat(cell) ? null : cell);
    } else {
      const removed = [...removedIndices];
      cells = cells.map((cell, index) => {
        if (!isCat(cell)) return cell;
        const [row,col] = rcOf(index);
        const touched = removed.some(other => {
          const [otherRow,otherCol] = rcOf(other);
          return Math.abs(row-otherRow) + Math.abs(col-otherCol) === 1;
        });
        if (!touched) return cell;
        return cell.armor > 0 ? { type:'cat', armor:cell.armor - 1 } : null;
      });
    }
    cells = cells.map(cell => typeof cell === 'number' && cell < min ? null : cell);
    const movements = [];
    for (let col=0; col<COLS; col++) {
      const stack=[];
      for (let row=ROWS-1; row>=0; row--) { const from=indexOf(row,col), v=cells[from]; if(v !== null) stack.push({value:v, from}); }
      for (let row=ROWS-1; row>=0; row--) {
        const to=indexOf(row,col), item=stack.shift();
        cells[to] = item ? item.value : randomPanel();
        movements.push({from:item?.from ?? null, to});
      }
    }
    return movements;
  }
  function hasConnectablePair() { return cells.some((cell,i) => !isCat(cell) && [i+1,i+COLS,i+COLS+1,i+COLS-1].some(j => j>=0 && j<SIZE && Math.abs((j%COLS)-(i%COLS))<=1 && !isCat(cells[j]) && cells[j]===cell)); }
  function checkGameOver() { if (!hasConnectablePair()) { ended=true; swapMode=false; finalScore.textContent=score.toLocaleString('ja-JP'); gameOver.hidden=false; updateStatus(); setHint('ゲームオーバー'); } }
  function useSwap(idx) {
    if (swapFirst === null) { swapFirst=idx; render(); setHint('入れ替えるもう1枚を選んでください'); return; }
    if (swapFirst === idx) { swapFirst=null; render(); return; }
    [cells[swapFirst],cells[idx]]=[cells[idx],cells[swapFirst]]; swaps=0; swapMode=false; swapFirst=null; render(); updateStatus(); setHint('位置を入れ替えました');
    saveGame();
    window.setTimeout(checkGameOver, 120);
  }
  boardWrap.addEventListener('pointerdown', e => { if(ended || animating) return; const idx=tileAtPoint(e.clientX,e.clientY); if(idx===null)return; if(swapMode) useSwap(idx); else if(!isCat(cells[idx])) { boardWrap.setPointerCapture(e.pointerId); startDrag(idx); } e.preventDefault(); });
  boardWrap.addEventListener('pointermove', e => { if(dragging) extendDrag(tileAtPoint(e.clientX,e.clientY)); });
  boardWrap.addEventListener('pointerup', endDrag); boardWrap.addEventListener('pointercancel', endDrag);
  swapButton.addEventListener('click', () => { if(!swaps || ended)return; swapMode=!swapMode; swapFirst=null; selected=[]; render(); updateStatus(); setHint(swapMode ? '入れ替えたい1枚目を選んでください' : '同じ干支を2枚以上なぞってつなごう'); });
  document.querySelector('#help').addEventListener('click', () => { helpPopup.hidden = false; });
  document.querySelectorAll('[data-close="help-popup"]').forEach(button => button.addEventListener('click', () => { helpPopup.hidden = true; }));
  document.querySelector('#record-continue').addEventListener('click', closeRecordPopup);
  document.querySelector('#restart').addEventListener('click', init); document.querySelector('#play-again').addEventListener('click', init);
  document.querySelector('#legend-items').innerHTML = animals.map((name,i) => `<span class="legend-item"><img src="eto/${i+1}.png" alt="${name}"><b>${value(i)}</b></span>`).join('');
  document.querySelectorAll('.mini-tile').forEach(tile => {
    const exp = Number(tile.dataset.exp);
    tile.innerHTML = `<img src="eto/${exp % 12 + 1}.png" alt="${animals[exp % 12]}"><span>${formatValue(exp)}</span>${lap(exp) > 1 ? `<i class="lap-badge">${lap(exp)}周</i>` : ''}`;
  });
  if (!loadGame()) init();
})();
