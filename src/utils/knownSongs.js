/**
 * Canonical song database: maps lowercase title variants → { title, artist }
 * The `title` field is the correct/canonical spelling used for display and lyrics fetching.
 */
const KNOWN_SONGS = {}

// Helper to register a song with multiple lookup variants
function reg(canonicalTitle, artist, ...altKeys) {
  const entry = { title: canonicalTitle, artist }
  const keys = [canonicalTitle.toLowerCase(), ...altKeys.map(k => k.toLowerCase())]
  for (const k of keys) {
    KNOWN_SONGS[k] = entry
  }
}

// Register all known songs with canonical titles and common misspellings
reg('Creep', 'Radiohead')
reg('Californication', 'Red Hot Chili Peppers')
reg('Sultans of Swing', 'Dire Straits')
reg("I Can't Dance", 'Genesis', 'i cant dance')
reg('Eye of the Tiger', 'Survivor')
reg('I Want It All', 'Queen')
reg('Crazy Little Thing Called Love', 'Queen')
reg('Every Breath You Take', 'The Police')
reg('November Rain', "Guns N' Roses")
reg('Radio Ga Ga', 'Queen', 'radio gaga')
reg('Africa', 'Toto')
reg("Don't Stop Believin'", 'Journey', "don't stop believing", "dont stop believing", "don't stop beliving", "dont stop beliving")
reg('Somebody to Love', 'Queen')
reg('I Want You Back', 'The Jackson 5')
reg("It's My Life", 'Bon Jovi', 'its my life')
reg('Basket Case', 'Green Day')
reg("Summer of '69", 'Bryan Adams', 'summer of 69')
reg('Walk of Life', 'Dire Straits')
reg('You Give Love a Bad Name', 'Bon Jovi')
reg("Don't Stop Me Now", 'Queen', 'dont stop me now')
reg("Livin' on a Prayer", 'Bon Jovi', 'livin on a prayer', 'living on a prayer')
reg('Mr. Brightside', 'The Killers', 'mr brightside')
reg('Smooth', 'Santana')
reg('I Want to Break Free', 'Queen')
reg('Hammer to Fall', 'Queen')
reg('Johnny B. Goode', 'Chuck Berry', 'johnny b goode', 'johnny b good')
reg('Hold the Line', 'Toto')
reg('Shallow', 'Lady Gaga')
reg('Fields of Gold', 'Sting')
reg('Love of My Life', 'Queen')
reg('Brothers in Arms', 'Dire Straits')
reg('Long Train Runnin\'', 'The Doobie Brothers', 'long train running', 'long train runnin')
reg('We Are the Champions', 'Queen')
reg('Around the World', 'Red Hot Chili Peppers')
reg('The Power of Love', 'Huey Lewis and the News')
reg('The Scientist', 'Coldplay')
reg("Can't Stop This Thing We Started", 'Bryan Adams', 'cant stop this thing we started')
reg('Hotel California', 'Eagles')
reg('My Sharona', 'The Knack')
reg('With or Without You', 'U2')
reg('Keep the Faith', 'Bon Jovi')
reg('More Than a Feeling', 'Boston', 'more then a feeling')
reg('Imagine', 'John Lennon')
reg('Stairway to Heaven', 'Led Zeppelin')
reg('Let It Be', 'The Beatles')
reg('Your Song', 'Elton John')
reg("Ain't No Sunshine", 'Bill Withers', 'aint no sunshine')
reg('A Kind of Magic', 'Queen')
reg('Bad Day', 'Daniel Powter')
reg("Cryin'", 'Aerosmith', 'cryin')
reg('Dani California', 'Red Hot Chili Peppers')
reg('Bed of Roses', 'Bon Jovi')
reg('Bohemian Rhapsody', 'Queen')
reg("Sweet Child O' Mine", "Guns N' Roses", 'sweet child o mine')
reg('Back in Black', 'AC/DC')
reg('Highway to Hell', 'AC/DC')
reg('Thunderstruck', 'AC/DC')
reg('Smoke on the Water', 'Deep Purple')
reg("Free Fallin'", 'Tom Petty', 'free fallin')
reg('Under the Bridge', 'Red Hot Chili Peppers')
reg('Every Rose Has Its Thorn', 'Poison')
reg('Wonderwall', 'Oasis')
reg('Come as You Are', 'Nirvana')
reg('Smells Like Teen Spirit', 'Nirvana')
reg('Take Me Home Tonight', 'Eddie Money')
reg('Wanted Dead or Alive', 'Bon Jovi')
reg('Always', 'Bon Jovi')
reg("I Was Made for Lovin' You", 'Kiss', 'i was made for lovin you')
reg("Rock and Roll All Nite", 'Kiss')
reg('Pour Some Sugar on Me', 'Def Leppard')
reg('Here I Go Again', 'Whitesnake')
reg('Is This Love', 'Whitesnake')
reg('The Final Countdown', 'Europe')
reg('Take on Me', 'a-ha')
reg('Total Eclipse of the Heart', 'Bonnie Tyler')
reg("Jessie's Girl", 'Rick Springfield', 'jessies girl')
reg("Don't Stop 'Til You Get Enough", 'Michael Jackson', 'dont stop til you get enough')
reg('Billie Jean', 'Michael Jackson')
reg('Beat It', 'Michael Jackson')
reg('Thriller', 'Michael Jackson')
reg('Faith', 'George Michael')
reg('Wake Me Up Before You Go-Go', 'Wham!', 'wake me up before you go go')
reg('Take My Breath Away', 'Berlin')
reg("Livin' la Vida Loca", 'Ricky Martin', 'livin la vida loca')
reg('Black or White', 'Michael Jackson')
reg('Pride (In the Name of Love)', 'U2', 'pride')
reg('One', 'U2')
reg('Where the Streets Have No Name', 'U2')
reg('Beautiful Day', 'U2')
reg('Yellow', 'Coldplay')
reg('Fix You', 'Coldplay')
reg('Clocks', 'Coldplay')
reg('Viva la Vida', 'Coldplay')
reg('Paradise', 'Coldplay')
reg('Seven Nation Army', 'The White Stripes')
reg('Use Somebody', 'Kings of Leon')
reg('Sex on Fire', 'Kings of Leon')
reg('Last Nite', 'The Strokes')
reg('She Will Be Loved', 'Maroon 5')
reg('This Love', 'Maroon 5')
reg('Moves Like Jagger', 'Maroon 5')
reg('Sugar', 'Maroon 5')
reg('Uptown Funk', 'Bruno Mars')
reg('Locked Out of Heaven', 'Bruno Mars')
reg('Just the Way You Are', 'Bruno Mars')
reg('Counting Stars', 'OneRepublic')
reg('Radioactive', 'Imagine Dragons')
reg('Believer', 'Imagine Dragons')
reg('Thunder', 'Imagine Dragons')
reg('Hysteria', 'Def Leppard')
reg('Photograph', 'Def Leppard')
reg('Animal', 'Def Leppard')
reg('Run to You', 'Bryan Adams')
reg('Heaven', 'Bryan Adams')
reg('Cuts Like a Knife', 'Bryan Adams')
reg("(Everything I Do) I Do It for You", 'Bryan Adams', 'everything i do')
reg('Have You Ever Really Loved a Woman?', 'Bryan Adams', 'have you ever really loved a woman')
reg('Money for Nothing', 'Dire Straits')
reg('Romeo and Juliet', 'Dire Straits')
reg('Land of Confusion', 'Genesis')
reg('Invisible Touch', 'Genesis')
reg('In the Air Tonight', 'Phil Collins')
reg('Against All Odds', 'Phil Collins')
reg('Easy Lover', 'Phil Collins')
reg('Another Day in Paradise', 'Phil Collins')
reg('Sledgehammer', 'Peter Gabriel')
reg('Dream On', 'Aerosmith')
reg('Walk This Way', 'Aerosmith')
reg("I Don't Want to Miss a Thing", 'Aerosmith', 'i dont want to miss a thing')
reg("Janie's Got a Gun", 'Aerosmith', 'janie got a gun')
reg('Roxanne', 'The Police')
reg('Message in a Bottle', 'The Police')
reg('Every Little Thing She Does Is Magic', 'The Police')
reg("Don't Stand So Close to Me", 'The Police', 'dont stand so close to me')
reg('Brown Eyed Girl', 'Van Morrison')
reg('(I Can\'t Get No) Satisfaction', 'The Rolling Stones', 'satisfaction')
reg('Paint It Black', 'The Rolling Stones')
reg("Jumpin' Jack Flash", 'The Rolling Stones', 'jumpin jack flash')
reg('Start Me Up', 'The Rolling Stones')
reg('Come Together', 'The Beatles')
reg('Hey Jude', 'The Beatles')
reg('Yesterday', 'The Beatles')
reg('Twist and Shout', 'The Beatles')
reg('Here Comes the Sun', 'The Beatles')
reg('I Saw Her Standing There', 'The Beatles')
reg('Helter Skelter', 'The Beatles')
reg('Born to Run', 'Bruce Springsteen')
reg('Dancing in the Dark', 'Bruce Springsteen')
reg('Glory Days', 'Bruce Springsteen')
reg('Born in the U.S.A.', 'Bruce Springsteen', 'born in the usa')
reg('Whole Lotta Love', 'Led Zeppelin')
reg('Rock and Roll', 'Led Zeppelin')
reg('Black Dog', 'Led Zeppelin')
reg('Paranoid', 'Black Sabbath')
reg('Iron Man', 'Black Sabbath')
reg('Purple Rain', 'Prince')
reg('Kiss', 'Prince')
reg('When Doves Cry', 'Prince')
reg('Under Pressure', 'Queen')
reg('We Will Rock You', 'Queen')
reg('Another One Bites the Dust', 'Queen')
reg('Killer Queen', 'Queen')
reg('Separate Ways', 'Journey')
reg('Any Way You Want It', 'Journey')
reg('Open Arms', 'Journey')
reg("Livin' on the Edge", 'Aerosmith', 'livin on the edge')
reg('Fortunate Son', 'Creedence Clearwater Revival')
reg('Proud Mary', 'Creedence Clearwater Revival')
reg('Bad Moon Rising', 'Creedence Clearwater Revival')
reg('Have You Ever Seen the Rain', 'Creedence Clearwater Revival')
reg('All Along the Watchtower', 'Jimi Hendrix')
reg('Purple Haze', 'Jimi Hendrix')
reg('Layla', 'Eric Clapton')
reg('Wonderful Tonight', 'Eric Clapton')
reg('Cocaine', 'Eric Clapton')
reg('Sunshine of Your Love', 'Cream')
reg('Black Magic Woman', 'Santana')
reg('Oye Como Va', 'Santana')

// Musicals & Soundtracks
reg('Defying Gravity', 'Idina Menzel', 'defying gravity')
reg('Popular', 'Kristin Chenoweth')
reg('For Good', 'Idina Menzel & Kristin Chenoweth')
reg('No Good Deed', 'Idina Menzel')
reg('What Is This Feeling?', 'Idina Menzel & Kristin Chenoweth', 'what is this feeling')
reg('The Wizard and I', 'Idina Menzel')
reg('Bohemian Rhapsody', 'Queen')
reg("Don't Rain on My Parade", 'Barbra Streisand', 'dont rain on my parade')
reg('Memory', 'Elaine Paige')
reg('The Phantom of the Opera', 'Andrew Lloyd Webber')
reg('All That Jazz', 'Catherine Zeta-Jones')
reg('Seasons of Love', 'Cast of Rent')
reg('One Day More', 'Cast of Les Miserables', 'les mis')
reg('I Dreamed a Dream', 'Anne Hathaway')
reg('On My Own', 'Samantha Barks')
reg('The Music of the Night', 'Michael Crawford')
reg('Tonight', 'Leonard Bernstein')
reg('Somewhere', 'Leonard Bernstein')
reg("Don't Cry for Me Argentina", 'Madonna', 'dont cry for me argentina')
reg('Circle of Life', 'Elton John')
reg('Can You Feel the Love Tonight', 'Elton John')
reg('A Whole New World', 'Peabo Bryson & Regina Belle')
reg('Let It Go', 'Idina Menzel')
reg('This Is Me', 'Keala Settle')
reg('Rewrite the Stars', 'Zac Efron & Zendaya')
reg('Never Enough', 'Loren Allred')
reg('Shallow', 'Lady Gaga & Bradley Cooper')
reg('Always Remember Us This Way', 'Lady Gaga')
reg("I'm Still Standing", 'Elton John', 'im still standing')
reg('Grease', 'Frankie Valli')
reg("You're the One That I Want", 'John Travolta & Olivia Newton-John', 'youre the one that i want')
reg('Summer Nights', 'John Travolta & Olivia Newton-John')
reg('Mamma Mia', 'ABBA')
reg('Dancing Queen', 'ABBA')
reg('Waterloo', 'ABBA')
reg('The Winner Takes It All', 'ABBA')
reg('SOS', 'ABBA')
reg('Fernando', 'ABBA')
reg('Gimme! Gimme! Gimme!', 'ABBA', 'gimme gimme gimme')
reg('Voulez-Vous', 'ABBA')
reg('Take a Chance on Me', 'ABBA')
reg('Knowing Me Knowing You', 'ABBA')

/**
 * Normalize a string for matching: lowercase, strip smart quotes,
 * remove accents, collapse whitespace.
 */
function normalize(s) {
  return s.toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")  // smart single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')   // smart double quotes → "
    .replace(/[\u2013\u2014\u2015]/g, '-')                       // em/en dashes → -
    .replace(/[^a-z0-9' -]/g, '')                                // strip non-alphanumeric
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Look up a song by title. Returns { title, artist } with canonical title,
 * or null if not found. Handles smart quotes, special characters,
 * and minor PDF extraction glitches (missing characters).
 */
export function lookupSong(title) {
  if (!title) return null

  const key = normalize(title)

  // Direct match
  if (KNOWN_SONGS[key]) return KNOWN_SONGS[key]

  // Try matching against normalized keys (handles smart quotes etc.)
  for (const [songKey, entry] of Object.entries(KNOWN_SONGS)) {
    if (normalize(songKey) === key) return entry
  }

  // Fuzzy match: sequential character matching to handle PDF corruption
  // e.g. "Mr ightside" matches "mr brightside" (missing 'B')
  let bestMatch = null
  let bestScore = 0

  for (const [songKey, entry] of Object.entries(KNOWN_SONGS)) {
    const nk = normalize(songKey)
    if (nk.length < 5 || key.length < 5) continue

    const shorter = nk.length <= key.length ? nk : key
    const longer = nk.length > key.length ? nk : key
    let matchLen = 0
    let si = 0
    for (let li = 0; li < longer.length && si < shorter.length; li++) {
      if (longer[li] === shorter[si]) {
        matchLen++
        si++
      }
    }
    const score = matchLen / shorter.length
    if (score >= 0.8 && score > bestScore) {
      bestScore = score
      bestMatch = entry
    }
  }

  return bestMatch
}

/**
 * Convenience: look up just the artist for a title.
 */
export function lookupArtist(title) {
  const result = lookupSong(title)
  return result ? result.artist : ''
}
