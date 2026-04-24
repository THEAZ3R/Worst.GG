const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

if (!RIOT_API_KEY) { console.error('FATAL: RIOT_API_KEY missing'); process.exit(1); }
if (!MONGODB_URI) { console.error('FATAL: MONGODB_URI missing'); process.exit(1); }

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB Atlas connected'))
  .catch(err => { console.error('MongoDB error:', err.message); process.exit(1); });

// ─── SCHEMAS ───
const SummonerSchema = new mongoose.Schema({
  puuid: { type: String, required: true, unique: true },
  gameName: String,
  tagLine: String,
  region: String,
  summonerLevel: Number,
  profileIconId: Number,
  accountId: String,
  summonerId: String,
  lastUpdated: { type: Date, default: Date.now },
  ranked: {
    solo: { tier: String, rank: String, lp: Number, wins: Number, losses: Number },
    flex: { tier: String, rank: String, lp: Number, wins: Number, losses: Number }
  }
});

const MatchSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  puuid: { type: String, required: true, index: true },
  gameCreation: Date,
  gameDuration: Number,
  championId: Number,
  championName: String,
  win: Boolean,
  kills: Number,
  deaths: Number,
  assists: Number,
  kda: Number,
  goldEarned: Number,
  cs: Number,
  visionScore: Number,
  damageDealt: Number,
  damageTaken: Number,
  role: String,
  lane: String,
  queueType: String,
  gameMode: String,
  items: [Number],
  runes: mongoose.Schema.Types.Mixed,
  summonerSpells: [Number],
  teamId: Number,
  teamKills: { type: Number, default: 1 },
  teamDeaths: Number,
  teamAssists: Number,
  teamGold: Number,
  turretKills: Number,
  inhibitorKills: Number,
  dragonKills: Number,
  baronKills: Number,
  opponentPuuid: String,
  opponentName: String,
  opponentTag: String,
  opponentChampionId: Number,
  opponentChampionName: String,
  opponentKills: Number,
  opponentDeaths: Number,
  opponentAssists: Number,
  opponentCs: Number,
  opponentGold: Number,
  opponentDamage: Number,
  opponentVision: Number,
  allParticipants: [mongoose.Schema.Types.Mixed],
  csPerMin: Number,
  goldPerMin: Number,
  damagePerMin: Number,
  visionPerMin: Number,
  killParticipation: Number,
  rating: Number,
  ratingRank: String
});

// CRITICAL: Compound index for match lookup by matchId+puuid
MatchSchema.index({ matchId: 1, puuid: 1 }, { unique: true });
MatchSchema.index({ matchId: 1 }); // Also index matchId alone for finding any copy

const ChampionStatsSchema = new mongoose.Schema({
  championId: { type: Number, required: true, unique: true },
  championName: String,
  games: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  totalKills: { type: Number, default: 0 },
  totalDeaths: { type: Number, default: 0 },
  totalAssists: { type: Number, default: 0 },
  totalGold: { type: Number, default: 0 },
  totalCs: { type: Number, default: 0 },
  totalDamage: { type: Number, default: 0 },
  totalVision: { type: Number, default: 0 },
  itemBuilds: mongoose.Schema.Types.Mixed,
  runeBuilds: mongoose.Schema.Types.Mixed,
  lastUpdated: { type: Date, default: Date.now }
});

// Stores one snapshot per lookup when ranked data is available
const LPHistorySchema = new mongoose.Schema({
  puuid:     { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now },
  solo: { tier: String, rank: String, lp: Number },
  flex: { tier: String, rank: String, lp: Number }
});
LPHistorySchema.index({ puuid: 1, timestamp: -1 });

const Summoner    = mongoose.model('Summoner',    SummonerSchema);
const Match       = mongoose.model('Match',       MatchSchema);
const ChampionStats = mongoose.model('ChampionStats', ChampionStatsSchema);
const LPHistory   = mongoose.model('LPHistory',   LPHistorySchema);

const REGION_ROUTING = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eune1: 'europe', tr1: 'europe', ru: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea'
};

let ddragonVersion = '14.8.1';
let championData = {};
let itemData = {};
let runeData = {};
let spellData = {};

async function loadDDragon() {
  try {
    const versionsRes = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    ddragonVersion = versionsRes.data[0];
    console.log('DDragon version:', ddragonVersion);
    
    const champRes = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`);
    for (const key in champRes.data.data) {
      const champ = champRes.data.data[key];
      championData[champ.key] = champ;
    }

    const itemRes = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/item.json`);
    itemData = itemRes.data.data;

    const runeRes = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/runesReforged.json`);
    runeData = runeRes.data;

    const spellRes = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/summoner.json`);
    for (const key in spellRes.data.data) {
      spellData[spellRes.data.data[key].key] = spellRes.data.data[key];
    }

    console.log('Data Dragon loaded');
  } catch (err) {
    console.error('DDragon error:', err.message);
  }
}
loadDDragon();

app.use(express.static(path.join(__dirname, '../client')));

function isFresh(date, hours = 1) {
  if (!date) return false;
  return (Date.now() - new Date(date).getTime()) < hours * 60 * 60 * 1000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRiotError(error) {
  if (error.response && error.response.data) {
    const d = error.response.data;
    if (d.status && d.status.message) return { status: error.response.status, message: d.status.message };
    if (d.message) return { status: error.response.status, message: d.message };
  }
  return { status: 500, message: error.message || 'Unknown error' };
}

function calculateRating(p, role, durationMin) {
  const kp = p.killParticipation || 0;
  const csMin = durationMin > 0 ? p.cs / durationMin : 0;
  const goldMin = durationMin > 0 ? p.goldEarned / durationMin : 0;
  const dmgMin = durationMin > 0 ? (p.damageDealt || 0) / durationMin : 0;
  const visMin = durationMin > 0 ? p.visionScore / durationMin : 0;
  const kda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths;
  
  let score = 0;
  
  switch(role) {
    case 'JUNGLE':
      score = (kp * 3) + (kda * 2) + ((p.dragonKills || 0) * 5) + ((p.baronKills || 0) * 8) + (visMin * 2) + (dmgMin / 100);
      break;
    case 'SUPPORT':
      score = (kp * 4) + (visMin * 5) + (kda * 2) + (p.assists * 0.5);
      break;
    case 'BOTTOM':
      score = (dmgMin / 50) + (csMin * 3) + (goldMin / 100) + (kda * 1.5) + (kp * 1);
      break;
    case 'MIDDLE':
      score = (dmgMin / 50) + (kda * 2) + (csMin * 2) + (kp * 2) + (goldMin / 100);
      break;
    case 'TOP':
      score = (kda * 2) + (csMin * 2.5) + (dmgMin / 60) + ((p.turretKills || 0) * 3) + (goldMin / 100);
      break;
    default:
      score = (kda * 2) + (kp * 2) + (csMin * 2) + (dmgMin / 100);
  }
  
  return Math.round(score * 10) / 10;
}

function getRank(rating, allRatings) {
  const sorted = [...allRatings].sort((a, b) => b - a);
  const rank = sorted.indexOf(rating) + 1;
  if (rank === 1) return 'S+';
  if (rank === 2) return 'S';
  if (rank === 3) return 'A';
  if (rank <= 5) return 'B';
  return 'C';
}

async function getPlayerRanks(puuids) {
  const summoners = await Summoner.find({ puuid: { $in: puuids } }).select('puuid ranked');
  const rankMap = {};
  for (const s of summoners) {
    if (s.ranked?.solo) {
      rankMap[s.puuid] = s.ranked.solo;
    }
  }
  return rankMap;
}

// ─── ROUTES ───

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ddragonVersion });
});

app.get('/api/clear-data', async (req, res) => {
  await Match.deleteMany({});
  await ChampionStats.deleteMany({});
  await Summoner.deleteMany({});
  res.json({ message: 'All data cleared.' });
});

app.get('/api/summoner/:gameName/:tagLine', async (req, res) => {
  try {
    const { gameName, tagLine } = req.params;
    const region = req.query.region || 'na1';
    const routing = REGION_ROUTING[region] || 'americas';

    console.log(`[SUMMONER] Looking up ${gameName}#${tagLine} on ${region}`);

    const accountRes = await axios.get(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );
    const puuid = accountRes.data.puuid;
    console.log(`[SUMMONER] PUUID: ${puuid}`);

    const summonerRes = await axios.get(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );
    const summonerData = summonerRes.data;
    console.log('[SUMMONER] Raw summoner response:', JSON.stringify(summonerData));

    let summonerId = summonerData.id || null;

    // Retry once if id is missing (Riot API bug)
    if (!summonerId) {
      console.log('[SUMMONER] id missing from Riot response, retrying in 1s...');
      await sleep(1000);
      try {
        const retryRes = await axios.get(
          `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
          { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
        );
        summonerId = retryRes.data.id || null;
        console.log('[SUMMONER] Retry result - id:', summonerId);
      } catch (e) {
        console.log('[SUMMONER] Retry failed:', e.message);
      }
    }

    // FALLBACK: Use summonerId extracted from match data
    if (!summonerId) {
      const existing = await Summoner.findOne({ puuid }).select('summonerId');
      summonerId = existing?.summonerId || null;
      if (summonerId) {
        console.log(`[SUMMONER] Using cached summonerId from match data: ${summonerId}`);
      }
    }

    console.log(`[SUMMONER] Level: ${summonerData.summonerLevel}, Icon: ${summonerData.profileIconId}, SummonerId: ${summonerId}`);

    let rankedData = null; // null = fetch failed; {} = fetch ok but unranked
    try {
      if (!summonerId) {
        console.error('[SUMMONER] No summonerId found in Riot response — skipping ranked fetch');
      } else {
        const rankedUrl = `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`;
        console.log(`[SUMMONER] Fetching ranked from: ${rankedUrl}`);

        const rankedRes = await axios.get(
          rankedUrl,
          { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
        );

        console.log(`[SUMMONER] Ranked entries count: ${rankedRes.data.length}`);
        console.log(`[SUMMONER] Ranked raw:`, JSON.stringify(rankedRes.data));

        rankedData = { solo: null, flex: null }; // fetch succeeded
        for (const entry of rankedRes.data) {
          const mapped = { tier: entry.tier, rank: entry.rank, lp: entry.leaguePoints, wins: entry.wins, losses: entry.losses };
          console.log(`[SUMMONER] Entry: ${entry.queueType} -> ${entry.tier} ${entry.rank} ${entry.leaguePoints}LP`);
          if (entry.queueType === 'RANKED_SOLO_5x5') rankedData.solo = mapped;
          if (entry.queueType === 'RANKED_FLEX_SR') rankedData.flex = mapped;
        }

        // Save LP history snapshot whenever we have a successful ranked response
        await LPHistory.create({
          puuid,
          timestamp: new Date(),
          solo: rankedData.solo ? { tier: rankedData.solo.tier, rank: rankedData.solo.rank, lp: rankedData.solo.lp } : null,
          flex: rankedData.flex ? { tier: rankedData.flex.tier, rank: rankedData.flex.rank, lp: rankedData.flex.lp } : null
        });
      }

    } catch (rankErr) {
      console.error('[SUMMONER] Ranked fetch FAILED:', rankErr.message);
      if (rankErr.response) {
        console.error('[SUMMONER] Ranked error status:', rankErr.response.status);
        console.error('[SUMMONER] Ranked error data:', rankErr.response.data);
      }
      // rankedData stays null — we won't overwrite the DB with nulls
    }

    console.log(`[SUMMONER] Final rankedData:`, JSON.stringify(rankedData));

    // Build the fields to update — only include `ranked` when the Riot API call succeeded
    const updateFields = {
      puuid,
      gameName: accountRes.data.gameName,
      tagLine: accountRes.data.tagLine,
      region,
      summonerLevel: summonerData.summonerLevel,
      profileIconId: summonerData.profileIconId,
      accountId: summonerData.accountId || null,
      lastUpdated: new Date()
    };
    if (summonerId) updateFields.summonerId = summonerId;
    if (rankedData !== null) updateFields.ranked = rankedData;

    const summoner = await Summoner.findOneAndUpdate(
      { puuid },
      updateFields,
      { upsert: true, returnDocument: 'after' }
    );

    res.json(summoner);

  } catch (error) {
    console.error('[SUMMONER] Main error:', error.message);
    const { status, message } = getRiotError(error);
    res.status(status).json({ error: message });
  }
});

app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    const region = req.query.region || 'na1';
    const routing = REGION_ROUTING[region] || 'americas';

    let cached = await Match.find({ puuid }).sort({ gameCreation: -1 }).limit(20);
    
    cached = cached.map(m => {
      const doc = m.toObject();
      const durationMin = doc.gameDuration / 60;
      if (doc.csPerMin == null) doc.csPerMin = durationMin > 0 ? parseFloat((doc.cs / durationMin).toFixed(1)) : 0;
      if (doc.goldPerMin == null) doc.goldPerMin = durationMin > 0 ? Math.round(doc.goldEarned / durationMin) : 0;
      if (doc.damagePerMin == null) doc.damagePerMin = durationMin > 0 ? Math.round((doc.damageDealt || 0) / durationMin) : 0;
      if (doc.visionPerMin == null) doc.visionPerMin = durationMin > 0 ? parseFloat((doc.visionScore / durationMin).toFixed(1)) : 0;
      if (doc.killParticipation == null) {
        const tk = doc.teamKills || 1;
        doc.killParticipation = tk > 0 ? parseFloat(((doc.kills + doc.assists) / tk * 100).toFixed(1)) : 0;
      }
      return doc;
    });

    if (cached.length >= 5 && cached.every(m => isFresh(m.gameCreation, 24))) {
      return res.json(cached);
    }

    const matchListRes = await axios.get(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=20`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );

    const matchIds = matchListRes.data;
    const matches = [];

    for (const matchId of matchIds) {
      const exists = await Match.findOne({ matchId, puuid });
      if (exists) {
        const doc = exists.toObject();
        const durationMin = doc.gameDuration / 60;
        if (doc.csPerMin == null) doc.csPerMin = durationMin > 0 ? parseFloat((doc.cs / durationMin).toFixed(1)) : 0;
        if (doc.goldPerMin == null) doc.goldPerMin = durationMin > 0 ? Math.round(doc.goldEarned / durationMin) : 0;
        if (doc.damagePerMin == null) doc.damagePerMin = durationMin > 0 ? Math.round((doc.damageDealt || 0) / durationMin) : 0;
        if (doc.visionPerMin == null) doc.visionPerMin = durationMin > 0 ? parseFloat((doc.visionScore / durationMin).toFixed(1)) : 0;
        if (doc.killParticipation == null) {
          const tk = doc.teamKills || 1;
          doc.killParticipation = tk > 0 ? parseFloat(((doc.kills + doc.assists) / tk * 100).toFixed(1)) : 0;
        }
        matches.push(doc);
        continue;
      }

      const matchRes = await axios.get(
        `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
      );

      const info = matchRes.data.info;
      const participant = info.participants.find(p => p.puuid === puuid);
      if (!participant) continue;

      // EXTRACT SUMMONERID FROM MATCH DATA (Riot API workaround)
      if (participant.summonerId) {
        await Summoner.updateOne(
          { puuid, $or: [{ summonerId: { $exists: false } }, { summonerId: null }] },
          { $set: { summonerId: participant.summonerId } }
        );
        console.log(`[MATCH] Cached summonerId ${participant.summonerId} from match ${matchId}`);
      }

      const durationMin = info.gameDuration / 60;
      const teamKills = info.teams.find(t => t.teamId === participant.teamId)?.objectives?.champion?.kills || 1;
      
      const kp = teamKills > 0 ? ((participant.kills + participant.assists) / teamKills * 100) : 0;
      const kpSafe = isFinite(kp) ? kp : 0;

      const kda = participant.deaths === 0
        ? participant.kills + participant.assists
        : parseFloat(((participant.kills + participant.assists) / participant.deaths).toFixed(2));

      const csMin = durationMin > 0 ? parseFloat((participant.totalMinionsKilled / durationMin).toFixed(1)) : 0;
      const goldMin = durationMin > 0 ? Math.round(participant.goldEarned / durationMin) : 0;
      const dmgMin = durationMin > 0 ? Math.round((participant.totalDamageDealtToChampions || 0) / durationMin) : 0;
      const visMin = durationMin > 0 ? parseFloat((participant.visionScore / durationMin).toFixed(1)) : 0;

      const opponent = info.participants.find(p => 
        p.teamId !== participant.teamId && 
        (p.teamPosition === participant.teamPosition || p.lane === participant.lane)
      );

      const allParticipants = info.participants.map(p => {
        const pDurationMin = info.gameDuration / 60;
        const pTeamKills = info.teams.find(t => t.teamId === p.teamId)?.objectives?.champion?.kills || 1;
        const pKpRaw = pTeamKills > 0 ? ((p.kills + p.assists) / pTeamKills * 100) : 0;
        const pKp = isFinite(pKpRaw) ? pKpRaw : 0;
        const pKda = p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths;
        
        return {
          puuid: p.puuid,
          gameName: p.riotIdGameName || p.summonerName || 'Unknown',
          tagLine: p.riotIdTagline || '',
          championId: p.championId,
          championName: p.championName,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          kda: parseFloat(pKda.toFixed(2)),
          cs: p.totalMinionsKilled + (p.neutralMinionsKilled || 0),
          csPerMin: pDurationMin > 0 ? parseFloat((p.totalMinionsKilled / pDurationMin).toFixed(1)) : 0,
          goldEarned: p.goldEarned,
          goldPerMin: pDurationMin > 0 ? Math.round(p.goldEarned / pDurationMin) : 0,
          damageDealt: p.totalDamageDealtToChampions || 0,
          damagePerMin: pDurationMin > 0 ? Math.round((p.totalDamageDealtToChampions || 0) / pDurationMin) : 0,
          visionScore: p.visionScore,
          visionPerMin: pDurationMin > 0 ? parseFloat((p.visionScore / pDurationMin).toFixed(1)) : 0,
          killParticipation: parseFloat(pKp.toFixed(1)),
          role: p.teamPosition || p.role || 'UNKNOWN',
          teamId: p.teamId,
          win: p.win,
          items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].filter(i => i > 0),
          runes: p.perks,
          summonerSpells: [p.summoner1Id, p.summoner2Id],
          turretKills: p.turretKills || 0,
          dragonKills: p.dragonKills || 0,
          baronKills: p.baronKills || 0,
          rating: 0,
          ratingRank: '',
          isMVP: false,
          isAce: false
        };
      });

      const ratings = allParticipants.map(p => calculateRating(p, p.role, durationMin));
      allParticipants.forEach((p, i) => {
        p.rating = ratings[i];
        p.ratingRank = getRank(ratings[i], ratings);
      });

      const winningTeam = allParticipants.filter(p => p.win);
      const losingTeam = allParticipants.filter(p => !p.win);
      const mvp = winningTeam.length > 0 ? winningTeam.sort((a, b) => b.rating - a.rating)[0] : null;
      const ace = losingTeam.length > 0 ? losingTeam.sort((a, b) => b.rating - a.rating)[0] : null;
      if (mvp) {
        const mvpIdx = allParticipants.findIndex(p => p.puuid === mvp.puuid);
        if (mvpIdx >= 0) allParticipants[mvpIdx].isMVP = true;
      }
      if (ace) {
        const aceIdx = allParticipants.findIndex(p => p.puuid === ace.puuid);
        if (aceIdx >= 0) allParticipants[aceIdx].isAce = true;
      }

      const queueNames = { 420: 'RANKED_SOLO', 440: 'RANKED_FLEX', 400: 'NORMAL_DRAFT', 430: 'NORMAL_BLIND', 450: 'ARAM', 700: 'CLASH' };

      const items = [participant.item0, participant.item1, participant.item2, participant.item3, participant.item4, participant.item5, participant.item6].filter(i => i > 0);

      const stats = await ChampionStats.findOne({ championId: participant.championId });
      let itemBuilds = stats?.itemBuilds || {};
      let runeBuilds = stats?.runeBuilds || {};

      if (items.length >= 3) {
        const coreBuild = items.slice(0, 3).join(',');
        if (!itemBuilds[coreBuild]) itemBuilds[coreBuild] = { items: items.slice(0, 3), wins: 0, games: 0 };
        itemBuilds[coreBuild].games++;
        if (participant.win) itemBuilds[coreBuild].wins++;
      }

      if (participant.perks && participant.perks.styles) {
        const primaryRunes = participant.perks.styles[0]?.selections?.slice(0, 4).map(s => s.perk).join(',');
        if (primaryRunes) {
          if (!runeBuilds[primaryRunes]) {
            runeBuilds[primaryRunes] = {
              runes: participant.perks.styles[0].selections.slice(0, 4),
              primaryStyle: participant.perks.styles[0]?.style,
              subStyle: participant.perks.styles[1]?.style,
              wins: 0, games: 0
            };
          }
          runeBuilds[primaryRunes].games++;
          if (participant.win) runeBuilds[primaryRunes].wins++;
        }
      }

      await ChampionStats.findOneAndUpdate(
        { championId: participant.championId },
        {
          championName: participant.championName,
          $inc: {
            games: 1, wins: participant.win ? 1 : 0, losses: participant.win ? 0 : 1,
            totalKills: participant.kills, totalDeaths: participant.deaths, totalAssists: participant.assists,
            totalGold: participant.goldEarned,
            totalCs: participant.totalMinionsKilled + (participant.neutralMinionsKilled || 0),
            totalDamage: participant.totalDamageDealtToChampions || 0,
            totalVision: participant.visionScore
          },
          itemBuilds, runeBuilds,
          lastUpdated: new Date()
        },
        { upsert: true }
      );

      const myRating = calculateRating({
        kills: participant.kills, deaths: participant.deaths, assists: participant.assists,
        cs: participant.totalMinionsKilled, goldEarned: participant.goldEarned,
        damageDealt: participant.totalDamageDealtToChampions || 0, visionScore: participant.visionScore,
        killParticipation: kpSafe, dragonKills: participant.dragonKills || 0,
        baronKills: participant.baronKills || 0, turretKills: participant.turretKills || 0
      }, participant.teamPosition || participant.role || 'UNKNOWN', durationMin);

      const myRatingRank = getRank(myRating, ratings);

      const matchDoc = new Match({
        matchId, puuid,
        gameCreation: new Date(info.gameCreation),
        gameDuration: info.gameDuration,
        championId: participant.championId,
        championName: participant.championName,
        win: participant.win,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        kda,
        goldEarned: participant.goldEarned,
        cs: participant.totalMinionsKilled + (participant.neutralMinionsKilled || 0),
        visionScore: participant.visionScore,
        damageDealt: participant.totalDamageDealtToChampions || 0,
        damageTaken: participant.totalDamageTaken,
        role: participant.teamPosition || participant.role || 'UNKNOWN',
        lane: participant.lane,
        queueType: queueNames[info.queueId] || `QUEUE_${info.queueId}`,
        gameMode: info.gameMode,
        items,
        runes: participant.perks,
        summonerSpells: [participant.summoner1Id, participant.summoner2Id],
        teamId: participant.teamId,
        teamKills: teamKills || 1,
        teamDeaths: info.teams.find(t => t.teamId === participant.teamId)?.objectives?.champion?.deaths || 0,
        teamAssists: info.teams.find(t => t.teamId === participant.teamId)?.objectives?.champion?.assists || 0,
        teamGold: info.participants.filter(p => p.teamId === participant.teamId).reduce((a, b) => a + b.goldEarned, 0),
        turretKills: participant.turretKills || 0,
        inhibitorKills: participant.inhibitorKills || 0,
        dragonKills: participant.dragonKills || 0,
        baronKills: participant.baronKills || 0,
        opponentPuuid: opponent?.puuid,
        opponentName: opponent?.riotIdGameName || opponent?.summonerName,
        opponentTag: opponent?.riotIdTagline || '',
        opponentChampionId: opponent?.championId,
        opponentChampionName: opponent?.championName,
        opponentKills: opponent?.kills,
        opponentDeaths: opponent?.deaths,
        opponentAssists: opponent?.assists,
        opponentCs: opponent ? (opponent.totalMinionsKilled + (opponent.neutralMinionsKilled || 0)) : 0,
        opponentGold: opponent?.goldEarned,
        opponentDamage: opponent?.totalDamageDealtToChampions,
        opponentVision: opponent?.visionScore,
        allParticipants,
        csPerMin: csMin,
        goldPerMin: goldMin,
        damagePerMin: dmgMin,
        visionPerMin: visMin,
        killParticipation: parseFloat(kpSafe.toFixed(1)),
        rating: myRating,
        ratingRank: myRatingRank
      });

      await matchDoc.save();
      matches.push(matchDoc.toObject());
      await sleep(1200);
    }

    res.json(matches);

  } catch (error) {
    const { status, message } = getRiotError(error);
    res.status(status).json({ error: message });
  }
});

app.get('/api/mastery/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    const region = req.query.region || 'na1';

    const masteryRes = await axios.get(
      `https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=20`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );

    const mastery = masteryRes.data.map(m => {
      const champ = championData[m.championId];
      return {
        ...m,
        championName: champ?.name || `Champion ${m.championId}`,
        championImage: champ ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champ.image.full}` : null,
        lastPlayTimeAgo: m.lastPlayTime ? Math.floor((Date.now() - m.lastPlayTime) / (1000 * 60 * 60 * 24)) : null
      };
    });

    res.json(mastery);
  } catch (error) {
    const { status, message } = getRiotError(error);
    res.status(status).json({ error: message });
  }
});

// CRITICAL FIX: Need puuid to find the right match copy
app.get('/api/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { puuid } = req.query; // Get puuid from query to find the right player's copy
    
    console.log(`[MATCH] Looking up match ${matchId} for puuid ${puuid || 'NONE'}`);
    
    let match;
    
    if (puuid) {
      // If we have puuid, find the specific player's copy
      match = await Match.findOne({ matchId, puuid });
    } else {
      // Fallback: find any copy (but this might be the wrong player)
      match = await Match.findOne({ matchId });
    }
    
    if (!match) {
      console.log(`[MATCH] Not found in database: ${matchId}`);
      return res.status(404).json({ error: 'Match not found. It may not have been saved yet, or you need to provide the player PUUID.' });
    }
    
    const doc = match.toObject();
    const durationMin = doc.gameDuration / 60;
    
    if (doc.csPerMin == null) doc.csPerMin = durationMin > 0 ? parseFloat((doc.cs / durationMin).toFixed(1)) : 0;
    if (doc.goldPerMin == null) doc.goldPerMin = durationMin > 0 ? Math.round(doc.goldEarned / durationMin) : 0;
    if (doc.damagePerMin == null) doc.damagePerMin = durationMin > 0 ? Math.round((doc.damageDealt || 0) / durationMin) : 0;
    if (doc.visionPerMin == null) doc.visionPerMin = durationMin > 0 ? parseFloat((doc.visionScore / durationMin).toFixed(1)) : 0;
    if (doc.killParticipation == null) {
      const tk = doc.teamKills || 1;
      doc.killParticipation = tk > 0 ? parseFloat(((doc.kills + doc.assists) / tk * 100).toFixed(1)) : 0;
    }
    
    if (doc.allParticipants && Array.isArray(doc.allParticipants)) {
      const puuids = doc.allParticipants.map(p => p.puuid);
      const rankMap = await getPlayerRanks(puuids);
      
      doc.allParticipants = doc.allParticipants.map(p => {
        const pDurationMin = doc.gameDuration / 60;
        if (p.csPerMin == null) p.csPerMin = pDurationMin > 0 ? parseFloat((p.cs / pDurationMin).toFixed(1)) : 0;
        if (p.goldPerMin == null) p.goldPerMin = pDurationMin > 0 ? Math.round(p.goldEarned / pDurationMin) : 0;
        if (p.damagePerMin == null) p.damagePerMin = pDurationMin > 0 ? Math.round((p.damageDealt || 0) / pDurationMin) : 0;
        if (p.visionPerMin == null) p.visionPerMin = pDurationMin > 0 ? parseFloat((p.visionScore / pDurationMin).toFixed(1)) : 0;
        p.ranked = rankMap[p.puuid] || null;
        return p;
      });
    }
    
    res.json(doc);
  } catch (error) {
    console.error('[MATCH] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/summoner-by-puuid/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    const region = req.query.region || 'na1';

    const summonerRes = await axios.get(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );

    const summonerId = summonerRes.data.id || summonerRes.data.summonerId || null;
    console.log(`[BY-PUUID] SummonerId resolved: ${summonerId}`);

    const routing = REGION_ROUTING[region] || 'americas';
    const accountRes = await axios.get(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
    );

    let rankedData = { solo: null, flex: null };
    try {
      if (!summonerId) {
        console.error('[BY-PUUID] No summonerId found — skipping ranked fetch');
      } else {
        const rankedRes = await axios.get(
          `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`,
          { headers: { 'X-Riot-Token': RIOT_API_KEY }, timeout: 10000 }
        );
        for (const entry of rankedRes.data) {
          const mapped = { tier: entry.tier, rank: entry.rank, lp: entry.leaguePoints, wins: entry.wins, losses: entry.losses };
          if (entry.queueType === 'RANKED_SOLO_5x5') rankedData.solo = mapped;
          if (entry.queueType === 'RANKED_FLEX_SR') rankedData.flex = mapped;
        }
      }
    } catch (rankErr) {
      console.error('[BY-PUUID] Ranked fetch error:', rankErr.message);
    }

    const summoner = await Summoner.findOneAndUpdate(
      { puuid },
      {
        puuid,
        gameName: accountRes.data.gameName,
        tagLine: accountRes.data.tagLine,
        region,
        summonerLevel: summonerRes.data.summonerLevel,
        profileIconId: summonerRes.data.profileIconId,
        summonerId: summonerId,
        lastUpdated: new Date(),
        ranked: rankedData
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.json(summoner);
  } catch (error) {
    const { status, message } = getRiotError(error);
    res.status(status).json({ error: message });
  }
});

app.get('/api/runes', (req, res) => {
  const map = {};
  for (const tree of runeData) {
    map[tree.id] = { icon: tree.icon, name: tree.name };
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        map[rune.id] = { icon: rune.icon, name: rune.name };
      }
    }
  }
  res.json({ version: ddragonVersion, runes: map });
});

// Returns up to 30 LP history snapshots for a player (newest last for charting)
app.get('/api/lp-history/:puuid', async (req, res) => {
  try {
    const history = await LPHistory.find({ puuid: req.params.puuid })
      .sort({ timestamp: -1 })
      .limit(30)
      .lean();
    res.json(history.reverse()); // chronological order for charts
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/champions/names', async (req, res) => {
  try {
    const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`);
    const champions = Object.values(response.data.data).map(c => ({
      id: parseInt(c.key),
      name: c.name,
      title: c.title,
      image: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${c.image.full}`,
      tags: c.tags
    }));
    res.json(champions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/champion/:championId', async (req, res) => {
  try {
    const championId = parseInt(req.params.championId);
    const stats = await ChampionStats.findOne({ championId });
    
    if (!stats) {
      return res.status(404).json({ error: 'No data for this champion. Search more players to populate the database.' });
    }

    const champ = championData[championId];

    const builds = Object.values(stats.itemBuilds || {})
      .sort((a, b) => b.games - a.games)
      .slice(0, 5)
      .map(b => ({
        items: b.items,
        games: b.games,
        wins: b.wins,
        winRate: b.games > 0 ? ((b.wins / b.games) * 100).toFixed(1) : 0,
        itemNames: b.items.map(id => itemData[id]?.name || `Item ${id}`),
        itemImages: b.items.map(id => `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`)
      }));

    const runes = Object.values(stats.runeBuilds || {})
      .sort((a, b) => b.games - a.games)
      .slice(0, 5)
      .map(b => {
        const runeNames = [];
        for (const r of b.runes || []) {
          let found = false;
          for (const tree of runeData) {
            for (const slot of tree.slots) {
              const rune = slot.runes.find(rune => rune.id === r.perk);
              if (rune) {
                runeNames.push(rune.name);
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (!found) runeNames.push(`Rune ${r.perk}`);
        }
        return {
          runes: b.runes,
          primaryStyle: b.primaryStyle,
          subStyle: b.subStyle,
          games: b.games,
          wins: b.wins,
          winRate: b.games > 0 ? ((b.wins / b.games) * 100).toFixed(1) : 0,
          runeNames
        };
      });

    const counterMatches = await Match.find({ championId, win: false }).limit(100);
    const counterStats = {};
    for (const m of counterMatches) {
      if (m.opponentChampionId) {
        if (!counterStats[m.opponentChampionId]) {
          counterStats[m.opponentChampionId] = { championId: m.opponentChampionId, championName: m.opponentChampionName, games: 0, wins: 0 };
        }
        counterStats[m.opponentChampionId].games++;
      }
    }
    const counters = Object.values(counterStats)
      .sort((a, b) => b.games - a.games)
      .slice(0, 5)
      .map(c => ({
        ...c,
        winRate: c.games > 0 ? ((c.wins / c.games) * 100).toFixed(1) : 0,
        image: championData[c.championId] ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championData[c.championId].image.full}` : null
      }));

    res.json({
      championId,
      championName: stats.championName,
      games: stats.games,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.games > 0 ? ((stats.wins / stats.games) * 100).toFixed(1) : 0,
      avgKda: stats.totalDeaths > 0
        ? ((stats.totalKills + stats.totalAssists) / stats.totalDeaths).toFixed(2)
        : (stats.totalKills + stats.totalAssists).toFixed(2),
      avgCs: stats.games > 0 ? (stats.totalCs / stats.games).toFixed(1) : 0,
      avgGold: stats.games > 0 ? Math.round(stats.totalGold / stats.games) : 0,
      avgDamage: stats.games > 0 ? Math.round(stats.totalDamage / stats.games) : 0,
      avgVision: stats.games > 0 ? (stats.totalVision / stats.games).toFixed(1) : 0,
      image: champ ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champ.image.full}` : null,
      builds,
      runes,
      counters
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});