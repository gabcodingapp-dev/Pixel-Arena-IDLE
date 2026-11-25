/* ============================================================
   data.js - the game's content and balance.
   Everything tunable lives here so the sim stays readable.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, D = (PA.D = {});

  /* ------------------------------------------------------------
     HEROES
     rarity 3..5, role decides battle behaviour:
       dps    - steady damage
       burst  - slow, heavy hits + AoE splash
       healer - mends the team
       tank   - soaks hits, taunts
     ------------------------------------------------------------ */
  D.HEROES = [
    {
      id: "rowan", name: "Rowan", title: "The Trailblazer", rarity: 5, role: "dps",
      sprite: "rowan", unlocked: true, cost: 0,
      blurb: "A farm kid with a lucky shovel and no sense of danger.",
      atk: 12, hp: 90, spd: 1.15, crit: 0.10,
      skill: { name: "Golden Dig", desc: "Every 5th swing erupts in coins, hitting all foes." }
    },
    {
      id: "luna", name: "Luna", title: "Star Witch", rarity: 5, role: "burst",
      sprite: "luna", unlocked: false, cost: 40,
      blurb: "Dropped out of the academy to chase comets. Very worth it.",
      atk: 21, hp: 62, spd: 0.58, crit: 0.18,
      skill: { name: "Meteor Fizz", desc: "Slow star bolts that splash 40% damage to neighbours." }
    },
    {
      id: "nixie", name: "Nixie", title: "Tide Spirit", rarity: 4, role: "healer",
      sprite: "nixie", unlocked: false, cost: 30,
      blurb: "A spring spirit who thinks everyone should hydrate more.",
      atk: 6, hp: 74, spd: 0.85, crit: 0.05,
      heal: 9,
      skill: { name: "Spring Blessing", desc: "Restores the team's HP while her orb is charged." }
    },
    {
      id: "fox", name: "Ember", title: "Scarf Fox", rarity: 3, role: "dps",
      sprite: "fox", unlocked: false, cost: 15,
      blurb: "Steals shiny things. Occasionally steals a kill.",
      atk: 9, hp: 54, spd: 1.5, crit: 0.22,
      skill: { name: "Quick Nip", desc: "Very fast attacks, high crit chance." }
    },
    {
      id: "bramble", name: "Bramble", title: "Moss Golem", rarity: 4, role: "tank",
      sprite: "boss", unlocked: false, cost: 25,
      blurb: "Reformed forest guardian. Still has the glowing eyes.",
      atk: 13, hp: 210, spd: 0.5, crit: 0.06, tank: true,
      skill: { name: "Root Wall", desc: "Taunts enemies and takes 35% less damage." }
    }
  ];

  /* ------------------------------------------------------------
     ENEMIES - templates scale with stage difficulty
     ------------------------------------------------------------ */
  D.ENEMIES = {
    slime: { sprite: "slime", name: "Sugar Slime", hp: 1.0, atk: 1.0, speed: 0.85, w: 0.60 },
    mimic: { sprite: "mimic", name: "Chest Mimic", hp: 1.35, atk: 1.15, speed: 1.0, w: 0.28 },
    boss: { sprite: "boss", name: "Guardian", hp: 5.2, atk: 1.5, speed: 0.7, w: 0.12 }
  };

  /* ------------------------------------------------------------
     STAGES - 4 chapters x 6 stages. Every stage has waves, then a
     boss on the 6th. Rewards scale with the stage index.
     ------------------------------------------------------------ */
  D.CHAPTERS = [
    { name: "Greenfield Path", scene: "farm", tint: "#8fd35f" },
    { name: "Whisperwood", scene: "battle", tint: "#5fbf8f" },
    { name: "Sunken Hollow", scene: "battle", tint: "#5fa8d3" },
    { name: "Emberpeak", scene: "battle", tint: "#e08a5f" }
  ];

  D.STAGE_NAMES = [
    ["Sunny Gate", "Carrot Row", "Old Fence", "Mill Pond", "Blossom Rise", "Farm Guardian"],
    ["Mossy Trail", "Glow Ferns", "Fern Hollow", "Whisper Spring", "Elder Stump", "Guardian of Roots"],
    ["Damp Steps", "Coral Shelf", "Lantern Deep", "Echo Pool", "Tide Vault", "Hollow Warden"],
    ["Ashen Road", "Cinder Slopes", "Smoke Shelf", "Magma Bloom", "Peak Shrine", "Ember Colossus"]
  ];

  D.buildStages = function () {
    var out = [];
    D.CHAPTERS.forEach(function (ch, ci) {
      for (var si = 0; si < 6; si++) {
        var idx = ci * 6 + si;
        var isBoss = si === 5;
        var enemyBase = Math.pow(1.42, idx) * 22;
        out.push({
          index: idx,
          chapter: ci,
          stage: si,
          id: (ci + 1) + "-" + (si + 1),
          name: D.STAGE_NAMES[ci][si],
          chapterName: ch.name,
          scene: ch.scene,
          isBoss: isBoss,
          waves: isBoss ? 1 : 4,
          enemyHp: enemyBase,
          enemyAtk: 2.2 + idx * 1.15,
          goldPerKill: Math.pow(1.36, idx) * 6,
          gemReward: isBoss ? 3 + ci : 0,
          // damage the player needs before a stage is "comfortable"
          power: Math.pow(1.45, idx) * 14
        });
      }
    });
    return out;
  };
  D.STAGES = D.buildStages();

  /* ------------------------------------------------------------
     FARM - the idle engine. Each building adds gold/sec.
     `reqStage` is the index of the stage you must clear to unlock it.
     `mult` is applied per level; `curve` is the price growth.
     ------------------------------------------------------------ */
  D.FARM = [
    {
      id: "plot", name: "Carrot Plot", icon: "🥕", base: 12, curve: 1.14, rate: 0.6,
      desc: "Sun-fed rows of carrots. The backbone of any fortune.",
      max: 40
    },
    {
      id: "shovel", name: "Golden Shovel", icon: "🥄", base: 90, curve: 1.18, rate: 2.6,
      desc: "Digs up buried coins faster than Rowan can lose them.",
      max: 30
    },
    {
      id: "compost", name: "Compost Heap", icon: "🍂", base: 420, curve: 1.20, rate: 11,
      desc: "Smells awful. Yields absurdly good soil.",
      max: 25, reqStage: 1
    },
    {
      id: "beehive", name: "Bee Hive", icon: "🐝", base: 2600, curve: 1.22, rate: 48,
      desc: "Honey sells. The bees are paid in pollen and respect.",
      max: 22, reqStage: 5
    },
    {
      id: "scarecrow", name: "Scarecrow", icon: "🎃", base: 14000, curve: 1.24, rate: 220,
      desc: "Keeps crows off, keeps customers curious.",
      max: 20, reqStage: 11
    },
    {
      id: "market", name: "Market Stall", icon: "🧺", base: 82000, curve: 1.26, rate: 980,
      desc: "Passing heroes pay premium prices for a warm pie.",
      max: 18, reqStage: 17
    },
    {
      id: "greenhouse", name: "Greenhouse", icon: "🌿", base: 520000, curve: 1.28, rate: 4200,
      desc: "Grows three harvests a day. Some say four.",
      max: 16, reqStage: 23
    },
    {
      id: "clocktower", name: "Clocktower", icon: "🕰️", base: 3600000, curve: 1.30, rate: 21000,
      desc: "Ticks the whole valley into wealth. Literally.",
      max: 14, reqStage: 23
    }
  ];

  /* ------------------------------------------------------------
     ASCENSION - permanent multipliers bought with Essence
     ------------------------------------------------------------ */
  D.ASCEND = [
    { id: "might", name: "Heroic Might", icon: "⚔️", base: 8, curve: 1.35, per: 0.12, desc: "+12% hero damage per rank" },
    { id: "harvest", name: "Bountiful Harvest", icon: "🌾", base: 10, curve: 1.35, per: 0.10, desc: "+10% gold income per rank" },
    { id: "vigor", name: "Iron Vigor", icon: "🛡️", base: 12, curve: 1.4, per: 0.10, desc: "+10% hero HP per rank" },
    { id: "luck", name: "Lucky Clover", icon: "🍀", base: 15, curve: 1.45, per: 0.02, desc: "+2% crit chance per rank" }
  ];

  /* ------------------------------------------------------------
     QUESTS - long-tail goals, generous rewards so there is always
     something to claim when you open the app.
     ------------------------------------------------------------ */
  D.QUESTS = [
    { id: "q_kill10", stat: "kills", goal: 10, reward: { gold: 120 }, label: "Defeat 10 foes" },
    { id: "q_kill100", stat: "kills", goal: 100, reward: { gold: 2500, gem: 2 }, label: "Defeat 100 foes" },
    { id: "q_kill1000", stat: "kills", goal: 1000, reward: { gold: 90000, gem: 8 }, label: "Defeat 1,000 foes" },
    { id: "q_gold1k", stat: "goldEarned", goal: 1000, reward: { gem: 2 }, label: "Earn 1,000 gold" },
    { id: "q_gold1m", stat: "goldEarned", goal: 1000000, reward: { gem: 10, shard: 1 }, label: "Earn 1M gold" },
    { id: "q_upg10", stat: "upgrades", goal: 10, reward: { gold: 800 }, label: "Buy 10 farm upgrades" },
    { id: "q_upg50", stat: "upgrades", goal: 50, reward: { gem: 5 }, label: "Buy 50 farm upgrades" },
    { id: "q_stage5", stat: "stageBest", goal: 5, reward: { gold: 5000, gem: 2 }, label: "Clear Chapter 1 Stage 5" },
    { id: "q_stage12", stat: "stageBest", goal: 12, reward: { gem: 6 }, label: "Reach Whisperwood's end" },
    { id: "q_stage24", stat: "stageBest", goal: 24, reward: { gem: 15, shard: 2 }, label: "Conquer Emberpeak" },
    { id: "q_hero3", stat: "heroes", goal: 3, reward: { gem: 5 }, label: "Recruit 3 heroes" },
    { id: "q_hero5", stat: "heroes", goal: 5, reward: { gem: 12, shard: 1 }, label: "Recruit every hero" },
    { id: "q_prest1", stat: "rebirths", goal: 1, reward: { gem: 25 }, label: "Rebirth once" },
    { id: "q_lvl20", stat: "heroLevels", goal: 20, reward: { gold: 4000 }, label: "Reach 20 hero levels total" },
    { id: "q_lvl100", stat: "heroLevels", goal: 100, reward: { gem: 10 }, label: "Reach 100 hero levels total" }
  ];

  /* ------------------------------------------------------------
     Balance constants
     ------------------------------------------------------------ */
  D.BAL = {
    tick: 1 / 30,                 // sim step (s)
    autosave: 6,                  // seconds
    offlineCapHours: 8,
    offlineEfficiency: 0.55,
    heroLevelCostBase: 42,
    heroLevelCurve: 1.135,
    heroLevelStat: 0.085,         // +8.5% atk / hp per level
    maxTeam: 4,
    teamSlotsAt: [0, 0, 1, 2],    // slots unlocked per rebirth count
    waveDelay: 0.9,
    reviveTime: 4.5,
    bossTimer: 60,
    killGoldMul: 1.0,
    shopUnlockPower: 0.55
  };

  /* Research-free "star up" tuning: each star adds 18% to stats. */
  D.starMul = function (stars) { return 1 + (stars - 1) * 0.18; };
  D.ASC_MAX = 20;
})(typeof window !== "undefined" ? window : globalThis);
