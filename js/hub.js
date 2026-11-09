import { GAMES } from './games.js';

const list = document.getElementById('game-list');
const count = document.getElementById('game-count');

count.textContent = GAMES.length;

for (const game of GAMES) {
  const li = document.createElement('li');
  li.innerHTML = `
    <a class="game-card" href="${game.path}" style="--accent:${game.accent}">
      <div class="thumb"><img src="${game.thumbnail}" alt="" loading="lazy"></div>
      <div class="body">
        <h3>${game.title} <small>${game.subtitle}</small></h3>
        <p>${game.description}</p>
        <ul class="tags">${game.tags.map((t) => `<li>${t}</li>`).join('')}</ul>
        <span class="play">플레이 →</span>
      </div>
    </a>`;
  list.appendChild(li);
}

// 아직 추가되지 않은 자리
const soon = document.createElement('li');
soon.innerHTML = `<div class="game-card placeholder" aria-hidden="true"><span>다음 퍼즐 준비 중</span></div>`;
list.appendChild(soon);
