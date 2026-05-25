// Categories and words. Server-side only — never sent to the impostor.
// Each category has an English list and a Hebrew list; index correspondence
// is not required (we just pick by current room language).

const CATEGORIES = {
  food: {
    en: ['Pizza', 'Burger', 'Apple', 'Sushi', 'Ice Cream', 'Soup', 'Watermelon', 'Donut', 'Popcorn', 'Cupcake'],
    he: ['פיצה', 'המבורגר', 'תפוח', 'סושי', 'גלידה', 'מרק', 'אבטיח', 'סופגנייה', 'פופקורן', 'קאפקייק'],
  },
  animals: {
    en: ['Lion', 'Dog', 'Elephant', 'Cat', 'Monkey', 'Giraffe', 'Deer', 'Rhino', 'Zebra', 'Frog'],
    he: ['אריה', 'כלב', 'פיל', 'חתול', 'קוף', 'ג\'ירפה', 'צבי', 'קרנף', 'זברה', 'צפרדע'],
  },
  transportation: {
    en: ['Car', 'Airplane', 'Train', 'Bicycle', 'Ship', 'Rocket', 'Truck', 'Helicopter', 'Roller Coaster', 'Ambulance'],
    he: ['מכונית', 'מטוס', 'רכבת', 'אופניים', 'אונייה', 'רקטה', 'משאית', 'מסוק', 'רכבת הרים', 'אמבולנס'],
  },
  clothing: {
    en: ['Shirt', 'Shoes', 'Hat', 'Coat', 'Dress', 'Crown', 'Suit', 'Boots', 'Socks', 'Gloves'],
    he: ['חולצה', 'נעליים', 'כובע', 'מעיל', 'שמלה', 'כתר', 'חליפה', 'מגפיים', 'גרביים', 'כפפות'],
  },
  fantasy: {
    en: ['Unicorn', 'Dragon', 'Ghost', 'Castle', 'Monster', 'Wizard', 'Pirate', 'Witch', 'Alien', 'Goblin'],
    he: ['חד קרן', 'דרקון', 'רוח רפאים', 'טירה', 'מפלצת', 'קוסם', 'פיראט', 'מכשפה', 'חייזר', 'גובלין'],
  },
  nature: {
    en: ['Lightning', 'Rainbow', 'Tornado', 'Fire', 'Volcano', 'Island', 'Forest', 'Tree', 'Beach', 'Tsunami'],
    he: ['ברק', 'קשת בענן', 'טורנדו', 'אש', 'הר געש', 'אי', 'יער', 'עץ', 'חוף ים', 'צונאמי'],
  },
  places: {
    en: ['Farm', 'Museum', 'Airport', 'Playground', 'Gym', 'Water Park', 'Supermarket', 'Prison', 'Zoo', 'Cinema'],
    he: ['חווה', 'מוזיאון', 'נמל תעופה', 'גן משחקים', 'חדר כושר', 'פארק מים', 'סופרמרקט', 'בית סוהר', 'גן חיות', 'בית קולנוע'],
  },
  objects: {
    en: ['Piano', 'Compass', 'Slot Machine', 'Drone', 'Umbrella', 'Camera', 'Computer', 'Telescope', 'Chair', 'Bed'],
    he: ['פסנתר', 'מצפן', 'מכונת מזל', 'רחפן', 'מטרייה', 'מצלמה', 'מחשב', 'טלסקופ', 'כיסא', 'מיטה'],
  },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickCategory(requested) {
  if (requested && requested !== 'random' && CATEGORIES[requested]) {
    return requested;
  }
  return pickRandom(CATEGORY_KEYS);
}

function pickWord(categoryKey, lang) {
  const list = CATEGORIES[categoryKey][lang] || CATEGORIES[categoryKey].en;
  return pickRandom(list);
}

// Used by bot impostor when "guessing" — always wrong, picks any other word.
function pickWrongWord(categoryKey, lang, correctWord) {
  const list = CATEGORIES[categoryKey][lang] || CATEGORIES[categoryKey].en;
  const others = list.filter((w) => w !== correctWord);
  return pickRandom(others.length ? others : list);
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  pickCategory,
  pickWord,
  pickWrongWord,
};
