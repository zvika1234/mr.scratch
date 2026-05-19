// Categories and words. Server-side only — never sent to the impostor.
// Each category has an English list and a Hebrew list; index correspondence
// is not required (we just pick by current room language).

const CATEGORIES = {
  food: {
    en: ['Pizza', 'Burger', 'Apple', 'Sushi', 'Ice Cream'],
    he: ['פיצה', 'המבורגר', 'תפוח', 'סושי', 'גלידה'],
  },
  animals: {
    en: ['Lion', 'Dog', 'Elephant', 'Cat', 'Monkey'],
    he: ['אריה', 'כלב', 'פיל', 'חתול', 'קוף'],
  },
  transportation: {
    en: ['Car', 'Airplane', 'Train', 'Bicycle', 'Ship'],
    he: ['מכונית', 'מטוס', 'רכבת', 'אופניים', 'אונייה'],
  },
  clothing: {
    en: ['Shirt', 'Shoes', 'Hat', 'Coat', 'Dress'],
    he: ['חולצה', 'נעליים', 'כובע', 'מעיל', 'שמלה'],
  },
  fitness: {
    en: ['Dumbbell', 'Bicycle', 'Running Shoes', 'Treadmill', 'Yoga Mat'],
    he: ['משקולת', 'אופניים', 'נעלי ריצה', 'הליכון', 'מזרון יוגה'],
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
