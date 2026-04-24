const API_URL = window.location.origin.includes('localhost') ? 'http://localhost:5000/api' : '/api';
let currentRegion = 'na1';
let currentDDragonVersion = '14.8.1';
let currentPuuid = null;
let runeIconMap = {}; // { [runeId]: { icon: 'perk-images/...', name: '...' } }

fetch(`${API_URL}/health`).then(r => r.json()).then(d => {
  if (d.ddragonVersion) currentDDragonVersion = d.ddragonVersion;
}).catch(() => {});

fetch(`${API_URL}/runes`).then(r => r.json()).then(d => {
  runeIconMap = d.runes || {};
}).catch(() => {});

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  if (page === 'lookup') document.getElementById('nav-lookup').classList.add('active');
  if (page === 'champions') {
    document.getElementById('nav-champions').classList.add('active');
    loadChampions();
  }
}

async function searchSummoner() {
  const gameName = document.getElementById('gameName').value.trim();
  const tagLine = document.getElementById('tagLine').value.trim();
  currentRegion = document.getElementById('region').value;

  if (!gameName || !tagLine) {
    showError('Enter both Game Name and Tag Line');
    return;
  }

  document.getElementById('loading').style.display = 'block';
  document.getElementById('error').style.display = 'none';
  document.getElementById('profile').innerHTML = '';
  document.getElementById('mastery').innerHTML = '';
  document.getElementById('matches').innerHTML = '';

  try {
    const profileRes = await fetch(`${API_URL}/summoner/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?region=${currentRegion}`);
    const profile = await profileRes.json();

    if (!profileRes.ok) {
      showError(profile.error || `Error ${profileRes.status}`);
      return;
    }

    currentPuuid = profile.puuid;
    console.log('Profile data:', profile);
    console.log('Ranked data:', JSON.stringify(profile.ranked));

    renderProfile(profile);

    const [matchesRes, masteryRes] = await Promise.all([
      fetch(`${API_URL}/matches/${profile.puuid}?region=${currentRegion}`),
      fetch(`${API_URL}/mastery/${profile.puuid}?region=${currentRegion}`)
    ]);

    if (masteryRes.ok) {
      const mastery = await masteryRes.json();
      renderMastery(mastery);
    }

    if (matchesRes.ok) {
      const matches = await matchesRes.json();
      if (!matches.error) renderMatches(matches);
    }

  } catch (err) {
    console.error(err);
    showError('Cannot connect to server.');
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function renderProfile(data) {
  const solo = data.ranked?.solo;
  let rankHtml = '';

  console.log('Rendering profile, solo:', solo);

  if (solo && solo.tier) {
    const total = (solo.wins || 0) + (solo.losses || 0);
    const wr = total > 0 ? ((solo.wins / total) * 100).toFixed(1) : 0;
    const wrClass = wr >= 50 ? 'winrate-good' : 'winrate-bad';

    rankHtml = `
      <div class="rank-box">
        <div class="rank-tier" style="color:${getTierColor(solo.tier)}">${solo.tier} ${solo.rank}</div>
        <div class="rank-lp">${solo.lp} LP</div>
        <div class="rank-record"><span class="${wrClass}">${wr}% WR</span> — ${solo.wins}W / ${solo.losses}L</div>
      </div>`;
  } else {
    rankHtml = `<div class="rank-box"><div class="rank-tier" style="color:var(--text-muted)">Unranked</div></div>`;
  }

  const flex = data.ranked?.flex;
  if (flex && flex.tier) {
    const total = (flex.wins || 0) + (flex.losses || 0);
    const wr = total > 0 ? ((flex.wins / total) * 100).toFixed(1) : 0;
    rankHtml += `
      <div class="rank-box">
        <div class="rank-tier" style="color:${getTierColor(flex.tier)}">Flex ${flex.tier} ${flex.rank}</div>
        <div class="rank-lp">${flex.lp} LP</div>
        <div class="rank-record"><span class="${wr >= 50 ? 'winrate-good' : 'winrate-bad'}">${wr}% WR</span></div>
      </div>`;
  }

  const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/profileicon/${data.profileIconId}.png`;

  document.getElementById('profile').innerHTML = `
    <div class="profile-card">
      <img src="${iconUrl}" alt="icon" class="profile-icon" onerror="this.onerror=null;this.src='https://ddragon.leagueoflegends.com/cdn/14.8.1/img/profileicon/0.png'">
      <div class="profile-info">
        <h2>${data.gameName} <span class="profile-tag">#${data.tagLine}</span></h2>
        <div class="profile-level">Level ${data.summonerLevel}</div>
        <div class="rank-section">${rankHtml}</div>
      </div>
    </div>`;
}

function getTierColor(tier) {
  const colors = {
    'IRON': '#524a48', 'BRONZE': '#8c523a', 'SILVER': '#80989d',
    'GOLD': '#c8aa6e', 'PLATINUM': '#4e9996', 'EMERALD': '#2aab6c',
    'DIAMOND': '#576ece', 'MASTER': '#9a4ec7', 'GRANDMASTER': '#e84057',
    'CHALLENGER': '#f0e6d2'
  };
  return colors[tier] || '#a09b8c';
}

function renderMastery(list) {
  if (!list || list.length === 0) return;
  let html = '<div class="mastery-section"><div class="section-header"><div class="section-title">Champion Mastery</div></div><div class="mastery-carousel">';
  for (const m of list.slice(0, 10)) {
    const points = m.championPoints >= 1000000 
      ? (m.championPoints / 1000000).toFixed(1) + 'M' 
      : m.championPoints >= 1000 
        ? (m.championPoints / 1000).toFixed(0) + 'K' 
        : m.championPoints;
    html += `
      <div class="mastery-card" onclick="loadChampionDetail(${m.championId})">
        <img src="${m.championImage}" alt="${m.championName}" onerror="this.style.display='none'">
        <div class="mastery-champ-name">${m.championName}</div>
        <div class="mastery-points">${points} pts</div>
        <div class="mastery-level">Mastery ${m.championLevel}</div>
        ${m.chestGranted ? '<div class="mastery-chest">✦ Chest</div>' : ''}
      </div>`;
  }
  html += '</div></div>';
  document.getElementById('mastery').innerHTML = html;
}

function renderMatches(matches) {
  if (!matches || matches.length === 0) {
    document.getElementById('matches').innerHTML = '<div class="no-data">No matches found.</div>';
    return;
  }
  let html = '<div class="matches-section"><div class="section-header"><div class="section-title">Match History</div></div>';
  for (const m of matches) {
    const resultClass = m.win ? 'win' : 'loss';
    const resultText = m.win ? 'Victory' : 'Defeat';
    const mins = Math.floor(m.gameDuration / 60);
    const secs = m.gameDuration % 60;

    const csMin = m.csPerMin != null ? m.csPerMin : 0;
    const kp = m.killParticipation != null ? Math.round(m.killParticipation) : 0;
    const dmgMin = m.damagePerMin != null ? m.damagePerMin : 0;
    const visMin = m.visionPerMin != null ? m.visionPerMin : 0;
    const goldMin = m.goldPerMin != null ? m.goldPerMin : 0;

    let runesHtml = '';
    if (m.runes && m.runes.styles) {
      const primaryId = m.runes.styles[0]?.selections?.[0]?.perk;
      const secondaryStyleId = m.runes.styles[1]?.style;
      if (primaryId && runeIconMap[primaryId]) {
        runesHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/img/${runeIconMap[primaryId].icon}" class="rune-icon" title="${runeIconMap[primaryId].name}" onerror="this.style.display='none'">`;
      }
      if (secondaryStyleId && runeIconMap[secondaryStyleId]) {
        runesHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/img/${runeIconMap[secondaryStyleId].icon}" class="rune-icon" style="opacity:0.7" title="${runeIconMap[secondaryStyleId].name}" onerror="this.style.display='none'">`;
      }
    }

    let itemsHtml = '';
    for (let i = 0; i < 6; i++) {
      const itemId = m.items?.[i];
      if (itemId) itemsHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/item/${itemId}.png" class="item-icon" onerror="this.style.display='none'">`;
      else itemsHtml += `<div class="item-icon" style="opacity:0.2;background:var(--bg-secondary)"></div>`;
    }

    let spellsHtml = '';
    if (m.summonerSpells) {
      for (const spellId of m.summonerSpells) {
        spellsHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/spell/Summoner${getSpellName(spellId)}.png" class="rune-icon" onerror="this.style.display='none'">`;
      }
    }

    let opponentHtml = '';
    if (m.opponentName) {
      opponentHtml = `
        <div class="opponent-row">
          <div class="opponent-label">vs</div>
          <div class="opponent-info" onclick="event.stopPropagation(); viewOpponent('${m.opponentPuuid}', '${m.opponentName}', '${m.opponentTag || ''}')">
            <img src="https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/champion/${m.opponentChampionName}.png" onerror="this.src='https://via.placeholder.com/40'">
            <div>
              <div class="opponent-name">${m.opponentName}</div>
              <div class="opponent-tag">${m.opponentChampionName}</div>
            </div>
          </div>
        </div>`;
    }

    html += `
      <div class="match-card ${resultClass}" onclick="toggleMatchExpand('${m.matchId}')">
        <div class="match-main">
          <div class="match-result ${resultClass}">${resultText}</div>
          <div class="match-champion">
            <img src="https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/champion/${m.championName}.png" class="champ-img" onerror="this.style.display='none'">
            <div class="champ-info">
              <div class="champ-name">${m.championName}</div>
              <div class="champ-level">${m.role}</div>
            </div>
          </div>
          <div class="match-kda">
            <div class="kda-score">${m.kills}/${m.deaths}/${m.assists}</div>
            <div class="kda-ratio">${m.kda} KDA</div>
          </div>
          <div class="match-stats">
            <div class="stat-col"><div class="stat-value">${csMin}</div><div class="stat-label">CS/m</div></div>
            <div class="stat-col"><div class="stat-value">${kp}%</div><div class="stat-label">KP</div></div>
            <div class="stat-col"><div class="stat-value">${dmgMin}</div><div class="stat-label">DMG/m</div></div>
            <div class="stat-col"><div class="stat-value">${visMin}</div><div class="stat-label">Vis/m</div></div>
            <div class="stat-col"><div class="stat-value">${goldMin}</div><div class="stat-label">Gold/m</div></div>
          </div>
          <div class="match-build">${itemsHtml}</div>
          <div class="match-runes">${runesHtml}${spellsHtml}</div>
          <div class="match-duration">${mins}m ${secs}s<br><span class="match-date">${timeAgo(m.gameCreation)}</span></div>
        </div>
        <div id="expand-${m.matchId}" style="display:none;">
          ${opponentHtml}
          <div style="padding:10px 20px;">
            <button onclick="event.stopPropagation(); openMatchDetail('${m.matchId}')" class="search-btn" style="padding:8px 16px;font-size:0.85rem;">View Full Match Details</button>
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  document.getElementById('matches').innerHTML = html;
}

function getSpellName(id) {
  const spells = { 1: 'Boost', 3: 'Exhaust', 4: 'Flash', 6: 'Haste', 7: 'Heal', 11: 'Smite', 12: 'Teleport', 14: 'Dot', 21: 'Barrier', 32: 'Snowball' };
  return spells[id] || id;
}

function toggleMatchExpand(matchId) {
  const el = document.getElementById(`expand-${matchId}`);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function viewOpponent(puuid, name, tag) {
  if (!puuid) return;
  document.getElementById('gameName').value = name;
  document.getElementById('tagLine').value = tag || 'NA1';
  showPage('lookup');
  document.getElementById('loading').style.display = 'block';
  document.getElementById('error').style.display = 'none';
  document.getElementById('profile').innerHTML = '';
  document.getElementById('mastery').innerHTML = '';
  document.getElementById('matches').innerHTML = '';

  try {
    const res = await fetch(`${API_URL}/summoner-by-puuid/${puuid}?region=${currentRegion}`);
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Failed to load opponent');
      return;
    }
    currentPuuid = data.puuid;
    renderProfile(data);

    const [matchesRes, masteryRes] = await Promise.all([
      fetch(`${API_URL}/matches/${puuid}?region=${currentRegion}`),
      fetch(`${API_URL}/mastery/${puuid}?region=${currentRegion}`)
    ]);

    if (masteryRes.ok) {
      const mastery = await masteryRes.json();
      renderMastery(mastery);
    }
    if (matchesRes.ok) {
      const matches = await matchesRes.json();
      if (!matches.error) renderMatches(matches);
    }
  } catch (err) {
    showError('Failed to load opponent profile.');
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

async function openMatchDetail(matchId) {
  const modal = document.getElementById('matchModal');
  const content = document.getElementById('matchDetailContent');
  modal.style.display = 'flex';
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading match details...</p></div>';

  try {
    const url = currentPuuid 
      ? `${API_URL}/match/${matchId}?puuid=${currentPuuid}`
      : `${API_URL}/match/${matchId}`;
    
    console.log('Fetching match detail:', url);
    
    const res = await fetch(url);
    const match = await res.json();

    if (!res.ok) {
      content.innerHTML = `<div class="error-box">${match.error || 'Match not found'}</div>`;
      return;
    }

    const mins = Math.floor(match.gameDuration / 60);
    const secs = match.gameDuration % 60;

    let html = `
      <div class="match-detail-header">
        <div>
          <div class="match-detail-result ${match.win ? 'win' : 'loss'}" style="font-size:1.5rem;color:${match.win ? 'var(--blue)' : 'var(--red)'};">
            ${match.win ? 'Victory' : 'Defeat'}
          </div>
          <div class="match-detail-time">${match.queueType} • ${mins}m ${secs}s • ${timeAgo(match.gameCreation)}</div>
        </div>
      </div>
      <div class="teams-container">`;

    if (!match.allParticipants || !Array.isArray(match.allParticipants) || match.allParticipants.length === 0) {
      html += '<div class="error-box" style="margin:20px;">No participant data available. This match was saved before the update.</div></div>';
      content.innerHTML = html;
      return;
    }

    const teams = [100, 200];
    for (const teamId of teams) {
      const teamPlayers = match.allParticipants.filter(p => p.teamId === teamId);
      if (teamPlayers.length === 0) continue;
      const teamWon = teamPlayers[0]?.win;

      html += `
        <div class="team-section">
          <div class="team-header ${teamWon ? 'win' : 'loss'}">
            <div class="team-name">Team ${teamId === 100 ? 'Blue' : 'Red'}</div>
            <div class="team-result ${teamWon ? 'win' : 'loss'}">${teamWon ? 'WIN' : 'LOSS'}</div>
          </div>`;

      html += `
        <div class="player-row header">
          <div></div>
          <div>Player</div>
          <div>Rank</div>
          <div>KDA</div>
          <div>CS/m</div>
          <div>Gold/m</div>
          <div>DMG/m</div>
          <div>Vis/m</div>
          <div>KP%</div>
          <div>Rating</div>
          <div></div>
        </div>`;

      for (const p of teamPlayers) {
        const isMVP = p.isMVP === true;
        const isAce = p.isAce === true;
        const isOpponent = p.puuid !== match.puuid;

        let playerRunesHtml = '';
        
        if (p.runes && p.runes.styles && p.runes.styles.length > 0) {
          const primaryId = p.runes.styles[0]?.selections?.[0]?.perk;
          const secondaryStyleId = p.runes.styles[1]?.style;
          if (primaryId && runeIconMap[primaryId]) {
            playerRunesHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/img/${runeIconMap[primaryId].icon}" title="${runeIconMap[primaryId].name}" onerror="this.style.display='none'">`;
          }
          if (secondaryStyleId && runeIconMap[secondaryStyleId]) {
            playerRunesHtml += `<img src="https://ddragon.leagueoflegends.com/cdn/img/${runeIconMap[secondaryStyleId].icon}" class="secondary-rune" title="${runeIconMap[secondaryStyleId].name}" onerror="this.style.display='none'">`;
          }
        }

        let playerRankHtml = '<span style="color:var(--text-muted);font-size:0.75rem;">Not cached</span>';
        if (p.ranked && p.ranked.tier) {
          playerRankHtml = `<span style="color:${getTierColor(p.ranked.tier)};font-weight:700;font-size:0.75rem;">${p.ranked.tier} ${p.ranked.rank || ''}</span>`;
        }

        html += `
          <div class="player-row ${isMVP ? 'mvp' : ''} ${isAce ? 'ace' : ''} ${isOpponent ? 'clickable' : ''}"
               ${isOpponent ? `onclick="closeMatchModal(); viewOpponent('${p.puuid}', '${p.gameName}', '${p.tagLine}')"` : ''}>
            <div class="player-champ-wrap">
              <img src="https://ddragon.leagueoflegends.com/cdn/${currentDDragonVersion}/img/champion/${p.championName}.png" class="player-champ" onerror="this.style.display='none'">
              ${playerRunesHtml ? `<div class="player-runes-overlay">${playerRunesHtml}</div>` : ''}
            </div>
            <div class="player-name" title="${p.gameName}#${p.tagLine}">${p.gameName}</div>
            <div class="player-rank">${playerRankHtml}</div>
            <div>${p.kills}/${p.deaths}/${p.assists}</div>
            <div>${p.csPerMin != null ? p.csPerMin : '-'}</div>
            <div>${p.goldPerMin != null ? p.goldPerMin : '-'}</div>
            <div>${p.damagePerMin != null ? p.damagePerMin : '-'}</div>
            <div>${p.visionPerMin != null ? p.visionPerMin : '-'}</div>
            <div>${p.killParticipation != null ? Math.round(p.killParticipation) + '%' : '-'}</div>
            <div><span class="badge badge-rating">${p.ratingRank || '?'} ${p.rating || 0}</span></div>
            <div>
              ${isMVP ? '<span class="badge badge-mvp">MVP</span>' : ''}
              ${isAce ? '<span class="badge badge-ace">ACE</span>' : ''}
            </div>
          </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    content.innerHTML = html;
  } catch (err) {
    console.error('Modal error:', err);
    content.innerHTML = '<div class="error-box">Failed to load match details. Check console.</div>';
  }
}

function closeMatchModal() {
  document.getElementById('matchModal').style.display = 'none';
}

let allChampions = [];

async function loadChampions() {
  const grid = document.getElementById('championGrid');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const res = await fetch(`${API_URL}/champions/names`);
    allChampions = await res.json();
    renderChampionGrid(allChampions);
  } catch (err) {
    console.error('Champions error:', err);
    grid.innerHTML = '<div class="error-box">Failed to load champions.</div>';
  }
}

function renderChampionGrid(champions) {
  const grid = document.getElementById('championGrid');
  grid.innerHTML = '';
  for (const champ of champions) {
    const card = document.createElement('div');
    card.className = 'champion-card';
    card.onclick = () => loadChampionDetail(champ.id);
    card.innerHTML = `
      <img src="${champ.image}" alt="${champ.name}" onerror="this.style.display='none'">
      <div class="champion-card-name">${champ.name}</div>
    `;
    grid.appendChild(card);
  }
}

function filterChampions() {
  const query = document.getElementById('championSearch').value.toLowerCase();
  const filtered = allChampions.filter(c => c.name.toLowerCase().includes(query));
  renderChampionGrid(filtered);
}

async function loadChampionDetail(championId) {
  showPage('champion-detail');
  const detail = document.getElementById('championDetail');
  detail.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API_URL}/champion/${championId}`);
    const data = await res.json();

    if (!res.ok) {
      detail.innerHTML = `<div class="error-box">${data.error || 'No data for this champion.'}</div>
        <div class="no-data" style="margin-top:10px;">Champion stats are built by aggregating matches from player lookups. Search some players who play this champion to populate the database.</div>`;
      return;
    }

    let buildsHtml = '';
    if (data.builds && data.builds.length > 0) {
      buildsHtml = '<div class="section-title">Best Builds</div><div class="builds-grid">';
      for (const b of data.builds) {
        buildsHtml += `
          <div class="build-card">
            <div class="build-header">
              <span class="build-winrate">${b.winRate}% WR</span>
              <span class="build-games">${b.games} games</span>
            </div>
            <div class="build-items">
              ${b.items.map((id, i) => `
                <div class="item-slot" title="${b.itemNames[i]}">
                  <img src="${b.itemImages[i]}" onerror="this.style.display='none'">
                </div>
              `).join('')}
            </div>
            <div class="build-items-names">${b.itemNames.join(' → ')}</div>
          </div>`;
      }
      buildsHtml += '</div>';
    } else {
      buildsHtml = '<div class="no-data">No build data yet. Search more players who play this champion.</div>';
    }

    let runesHtml = '';
    if (data.runes && data.runes.length > 0) {
      runesHtml = '<div class="section-title">Best Runes</div><div class="runes-grid">';
      for (const r of data.runes) {
        runesHtml += `
          <div class="rune-card">
            <div class="build-header">
              <span class="build-winrate">${r.winRate}% WR</span>
              <span class="build-games">${r.games} games</span>
            </div>
            <div class="rune-list">
              ${r.runeNames.map(name => `<div class="rune-name">• ${name}</div>`).join('')}
            </div>
          </div>`;
      }
      runesHtml += '</div>';
    } else {
      runesHtml = '<div class="no-data">No rune data yet. Search more players who play this champion.</div>';
    }

    let countersHtml = '';
    if (data.counters && data.counters.length > 0) {
      countersHtml = '<div class="section-title">Counters (Toughest Matchups)</div><div class="counters-grid">';
      for (const c of data.counters) {
        countersHtml += `
          <div class="counter-card">
            <img src="${c.image}" alt="${c.championName}" onerror="this.style.display='none'">
            <div class="counter-name">${c.championName}</div>
            <div class="counter-games">${c.games} games vs</div>
          </div>`;
      }
      countersHtml += '</div>';
    } else {
      countersHtml = '<div class="no-data">No counter data yet.</div>';
    }

    detail.innerHTML = `
      <div class="champion-header">
        <img src="${data.image}" class="champion-big-img" onerror="this.style.display='none'">
        <div class="champion-header-info">
          <h1>${data.championName}</h1>
          <div class="champion-stats">
            <span class="stat-box">${data.games} Games</span>
            <span class="stat-box winrate-${data.winRate >= 50 ? 'good' : 'bad'}">${data.winRate}% WR</span>
            <span class="stat-box">${data.avgKda} KDA</span>
            <span class="stat-box">${data.avgCs} CS/m avg</span>
            <span class="stat-box">${data.avgGold} Gold avg</span>
            <span class="stat-box">${data.avgDamage} DMG avg</span>
          </div>
        </div>
      </div>
      ${buildsHtml}
      ${runesHtml}
      ${countersHtml}`;

  } catch (err) {
    detail.innerHTML = '<div class="error-box">Failed to load champion details.</div>';
  }
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gameName').addEventListener('keypress', e => { if (e.key === 'Enter') searchSummoner(); });
  document.getElementById('tagLine').addEventListener('keypress', e => { if (e.key === 'Enter') searchSummoner(); });
});

document.getElementById('matchModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'matchModal') closeMatchModal();
});