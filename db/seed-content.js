#!/usr/bin/env node
'use strict';

/**
 * Seed the content table from the canonical list below.
 *
 * Re-running is non-destructive: existing keys are left alone. Only new keys
 * are inserted. Labels/descriptions on existing keys are updated so that
 * tweaking the editor UX doesn't require a wipe.
 *
 * Convention:  key = page.section.field
 * Kinds:       text | markdown | html | image
 */

const Database = require('better-sqlite3');
const config = require('../server/config');

const SEED = [
  // ---------- Global / site ----------
  ['site.title',         'Mercy Presbyterian Church · Dallas', 'text', 'site', 'global', 'Default page title'],
  ['site.description',   'A gospel-centered church in Dallas. Sundays at 10 AM, 12727 Hillcrest Dr.', 'text', 'site', 'global', 'Default meta description'],
  ['site.favicon',       'https://www.mercydallas.com/wp-content/uploads/favicon-mercy.png', 'image', 'site', 'global', 'Favicon URL'],

  // ---------- Header ----------
  ['header.strip.left',  'Sundays &middot; 10 o\'clock a.m. &middot; 12727 Hillcrest Dr., Dallas', 'html', 'site', 'header', 'Top strip, left side'],
  ['header.strip.right', 'Plan a visit', 'text', 'site', 'header', 'Top strip, right link text'],
  ['header.wordmark.name', 'Mercy Presbyterian', 'text', 'site', 'header', 'Wordmark name'],
  ['header.wordmark.sub',  'Dallas &middot; PCA<br/>Est. MMXIV', 'html', 'site', 'header', 'Wordmark subtitle'],

  // ---------- Footer ----------
  ['footer.wordmark',      'Mercy <span class="em">to</span> us.<br/>Mercy <span class="em">through</span> us.', 'html', 'site', 'footer', 'Footer wordmark'],
  ['footer.col_address.title', 'Mercy Presbyterian', 'text', 'site', 'footer', 'Address column title'],
  ['footer.col_address.body',  '12727 Hillcrest Drive<br/>Dallas, Texas 75230', 'html', 'site', 'footer', 'Address (HTML, use <br/> for line breaks)'],
  ['footer.col_address.phone', '972 · 685 · 9003', 'text', 'site', 'footer', 'Display phone'],
  ['footer.col_address.phone_link', '9726859003', 'text', 'site', 'footer', 'Phone for tel: link (digits only)'],
  ['footer.col_address.email', 'church@mercydallas.com', 'text', 'site', 'footer', 'Contact email'],
  ['footer.social.instagram',  'https://instagram.com/mercypresdallas', 'text', 'site', 'footer', 'Instagram URL'],
  ['footer.social.facebook',   'https://facebook.com/mercypresdallas',  'text', 'site', 'footer', 'Facebook URL'],
  ['footer.bottom.left',  'A member of the Presbyterian Church in America', 'text', 'site', 'footer', 'Footer bottom, left'],
  ['footer.bottom.right', '&copy; MMXXVI Mercy Presbyterian Church', 'html', 'site', 'footer', 'Footer bottom, right (copyright)'],

  // ---------- Home page ----------
  ['home.title',         'Mercy Presbyterian Church · Dallas', 'text', 'home', 'meta', 'Page title (browser tab)'],
  ['home.description',   'A gospel-centered church in Dallas. Sundays at 10 AM, 12727 Hillcrest Dr.', 'text', 'home', 'meta', 'Meta description'],
  ['home.hero.dateline', '<span>Volume MMXXVI &middot; № xix</span><span class="dot"></span><span>Mercy Presbyterian</span><span class="dot"></span><span>Dallas, Texas</span>', 'html', 'home', 'hero', 'Dateline above the headline'],
  ['home.hero.headline', 'Mercy <span class="em">to</span> us.<br/>Mercy <span class="em">through</span> us.', 'html', 'home', 'hero', 'Hero headline'],
  ['home.hero.image',    'https://www.mercydallas.com/wp-content/uploads/Mercy-Sanctuary-Welcome.png', 'image', 'home', 'hero', 'Hero image'],
  ['home.hero.image_alt','The Mercy Presbyterian sanctuary', 'text', 'home', 'hero', 'Hero image alt text'],
  ['home.hero.meta',     '<span class="gold-label">The Lord\'s Day</span><span>Sunday, 17 May 2026</span><span>Morning worship &middot; 10:00</span><span>12727 Hillcrest Drive</span>', 'html', 'home', 'hero', 'Hero meta block beside the image'],
  ['home.hero_card_1.title', 'Plan your first Sunday', 'text', 'home', 'hero cards', 'Card I title'],
  ['home.hero_card_1.desc',  'What to expect when you visit, parking, where the children meet.', 'text', 'home', 'hero cards', 'Card I description'],
  ['home.hero_card_2.title', 'Listen to a sermon', 'text', 'home', 'hero cards', 'Card II title'],
  ['home.hero_card_2.desc',  'Four hundred sermons in the archive. We are presently in Hebrews.', 'text', 'home', 'hero cards', 'Card II description'],
  ['home.hero_card_3.title', 'Find a community group', 'text', 'home', 'hero cards', 'Card III title'],
  ['home.hero_card_3.desc',  'A dozen homes across the city, gathered around scripture and table.', 'text', 'home', 'hero cards', 'Card III description'],
  ['home.pullquote.body', 'Mercy Presbyterian is a church <em>committed to glorifying God</em> by preaching, teaching, and living out the Gospel of Jesus Christ &mdash; that the mercies we have received might be carried into the city and the world.', 'html', 'home', 'pull quote', 'Pull quote body'],
  ['home.pullquote.attr', 'Our Mission · Mercy Presbyterian Church', 'text', 'home', 'pull quote', 'Pull quote attribution'],
  ['home.commitments.gathering.title', 'Gathering', 'text', 'home', 'three commitments', 'I. Title'],
  ['home.commitments.gathering.body',  'We gather weekly around the Word preached, the Lord\'s Supper broken, prayer offered, and song lifted &mdash; not as performance but as the people of God before the throne of grace.', 'html', 'home', 'three commitments', 'I. Body'],
  ['home.commitments.gathering.verse', 'Hebrews 10 · 19–25', 'text', 'home', 'three commitments', 'I. Verse'],
  ['home.commitments.growing.title',   'Growing', 'text', 'home', 'three commitments', 'II. Title'],
  ['home.commitments.growing.body',    'We grow into the likeness of Christ together &mdash; through scripture, community, confession, and the slow shaping of one another\'s lives in love.', 'html', 'home', 'three commitments', 'II. Body'],
  ['home.commitments.growing.verse',   '2 Peter 3 · 18', 'text', 'home', 'three commitments', 'II. Verse'],
  ['home.commitments.going.title',     'Going', 'text', 'home', 'three commitments', 'III. Title'],
  ['home.commitments.going.body',      'We are in the world, not of the world, for the world &mdash; sent to neighbors, the city, and the nations with the mercies we have received in Jesus Christ.', 'html', 'home', 'three commitments', 'III. Body'],
  ['home.commitments.going.verse',     'Matthew 5 · 14–16', 'text', 'home', 'three commitments', 'III. Verse'],
  ['home.featured.image',        'https://www.mercydallas.com/wp-content/uploads/Hebrews-square-border.png', 'image', 'home', 'featured sermon', 'Featured sermon art'],
  ['home.featured.image_alt',    'Hebrews: Drawn Near', 'text', 'home', 'featured sermon', 'Image alt'],
  ['home.featured.series_label', 'Series · Hebrews: Drawn Near', 'text', 'home', 'featured sermon', 'Series label under art'],
  ['home.featured.eyebrow_num',  '№ 418', 'text', 'home', 'featured sermon', 'Eyebrow number'],
  ['home.featured.eyebrow_date', 'Sunday · 10 May 2026', 'text', 'home', 'featured sermon', 'Eyebrow date'],
  ['home.featured.title',        'The full <em>assurance</em> of faith.', 'html', 'home', 'featured sermon', 'Sermon title'],
  ['home.featured.passage',      'Hebrews 10 · 19–25 · Rev. Doug Tharp', 'text', 'home', 'featured sermon', 'Passage line'],
  ['home.featured.summary',      '"Let us draw near with a true heart in full assurance of faith&hellip;" &mdash; on the boldness Christ secures and the community he commands.', 'html', 'home', 'featured sermon', 'Summary paragraph'],
  ['home.featured.audio_title',  'The Full Assurance of Faith', 'text', 'home', 'featured sermon', 'Audio player title'],
  ['home.series_1.eyebrow', 'Current', 'text', 'home', 'series strip', 'Series I eyebrow'],
  ['home.series_1.title',   'Hebrews: <em>Drawn Near</em>', 'html', 'home', 'series strip', 'Series I title'],
  ['home.series_1.body',    'Twelve sermons &middot; in progress. The supremacy of Christ and the perseverance of his people.', 'html', 'home', 'series strip', 'Series I body'],
  ['home.series_2.eyebrow', 'Spring 2026', 'text', 'home', 'series strip', 'Series II eyebrow'],
  ['home.series_2.title',   'Jonah', 'html', 'home', 'series strip', 'Series II title'],
  ['home.series_2.body',    'Four sermons &middot; complete. The reluctant prophet and the mercy of God to outsiders.', 'html', 'home', 'series strip', 'Series II body'],
  ['home.series_3.eyebrow', 'Lent 2026', 'text', 'home', 'series strip', 'Series III eyebrow'],
  ['home.series_3.title',   'Sermon on the Mount', 'html', 'home', 'series strip', 'Series III title'],
  ['home.series_3.body',    'Eight sermons &middot; complete. The kingdom that turns the world rightside up.', 'html', 'home', 'series strip', 'Series III body'],
  ['home.events.body', `<div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">14</span><span class="weekday">Thursday</span></div>
        <div class="event-body">
          <h3>Women's evening Bible study</h3>
          <div class="event-meta"><span>7:30 pm</span><span class="sep">&middot;</span><span>Fellowship Hall</span><span class="sep">&middot;</span><span>Childcare provided</span></div>
          <p>Week six of <em>Honest Evangelism</em> by Rico Tice. New attendees welcome.</p>
        </div>
        <div class="event-cta"><a href="/events" class="link-arrow">Details <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">17</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>The Lord's Day <em>&middot; Morning worship</em></h3>
          <div class="event-meta"><span>10:00 am</span><span class="sep">&middot;</span><span>Sanctuary</span><span class="sep">&middot;</span><span>Communion served</span></div>
          <p>Hebrews 10:19&ndash;25. Children's church for ages 4 &mdash; 2nd grade dismissed before the sermon.</p>
        </div>
        <div class="event-cta"><a href="/events" class="link-arrow">Order of worship <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">20</span><span class="weekday">Wednesday</span></div>
        <div class="event-body">
          <h3>Men's breakfast &amp; prayer</h3>
          <div class="event-meta"><span>6:30 am</span><span class="sep">&middot;</span><span>Fellowship Hall</span></div>
          <p>Coffee, eggs, and intercession before the work day begins.</p>
        </div>
        <div class="event-cta"><a href="/events" class="link-arrow">RSVP <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">24</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>Youth night <em>&middot; grades 6&ndash;12</em></h3>
          <div class="event-meta"><span>5:30 pm</span><span class="sep">&middot;</span><span>Foster home</span><span class="sep">&middot;</span><span>Dinner provided</span></div>
          <p>Discussion on the Beatitudes. Friends always welcome.</p>
        </div>
        <div class="event-cta"><a href="/events" class="link-arrow">Details <span class="arrow">&rarr;</span></a></div>
      </div>`, 'html', 'home', 'upcoming events', 'Upcoming events block (HTML)'],
  ['home.firsttime.headline', 'A word for the <span class="display-italic gold">first-time</span> visitor.', 'html', 'home', 'first-time', 'Headline'],
  ['home.firsttime.body_1',   'We are a Presbyterian church in the Reformed tradition, gathered each Lord\'s Day for the preached Word, the broken bread, songs old and new, and prayers shaped by scripture. We are members of the Presbyterian Church in America. You will find us neither austere nor casual &mdash; we hope, by God\'s grace, somewhere thoughtful and warm in between.', 'html', 'home', 'first-time', 'First paragraph'],
  ['home.firsttime.body_2',   'Come as you are. Park anywhere on the south lot. There will be someone at the door who would be glad to walk you in. Children of every age are welcome &mdash; we have nursery, Sunday school, and Children\'s Church for those who would rather not sit through a forty-minute exposition of Hebrews.', 'html', 'home', 'first-time', 'Second paragraph'],

  // ---------- Visit page ----------
  ['visit.title',  'Plan a Visit · Mercy Presbyterian Church', 'text', 'visit', 'meta', 'Page title'],
  ['visit.kicker', 'For the first-time visitor', 'text', 'visit', 'head', 'Kicker'],
  ['visit.headline', 'A first Sunday <span class="em">at</span> Mercy.', 'html', 'visit', 'head', 'Headline'],
  ['visit.deck',     'What to expect, where to park, where your children will go, and what we will do together for an hour.', 'text', 'visit', 'head', 'Deck'],
  ['visit.letter.body_1', 'We are glad that you are considering a visit. Whatever has brought you &mdash; curiosity, a friend, a hard season, a return to the church after some years away &mdash; you will be welcome. We will not single you out, and we will not pretend that everyone here has it all together. Mercy is, by the grace of God, a church of ordinary people gathering each Lord\'s Day to receive what we cannot manufacture.', 'html', 'visit', 'letter', 'Paragraph 1'],
  ['visit.letter.body_2', 'What you will find on a Sunday is a service that is, in its bones, very old: scripture read, the gospel preached at length, prayers offered, hymns and modern songs sung, the Lord\'s Supper celebrated weekly, and a benediction given. We are unhurried. There is a printed bulletin. The pastor wears a robe. The children stay with their families for the early portion of the service and are dismissed before the sermon. We hope you\'ll come.', 'html', 'visit', 'letter', 'Paragraph 2'],
  ['visit.letter.signature', '&mdash; The Elders of Mercy Presbyterian Church', 'html', 'visit', 'letter', 'Signature'],
  ['visit.bulletin.subtitle', 'Sunday · 17 May 2026', 'text', 'visit', 'order of worship', 'Bulletin date'],
  ['visit.bulletin.title',    'The Lord\'s Day Morning', 'text', 'visit', 'order of worship', 'Bulletin title'],
  ['visit.bulletin.items', `<li><span class="ord-num">i.</span><span class="name">Call to Worship</span></li>
        <li><span class="ord-num">ii.</span><span class="name">Invocation</span></li>
        <li><span class="ord-num">iii.</span><span class="name">Hymn of Praise</span></li>
        <li><span class="ord-num">iv.</span><span class="name">Confession of Sin &amp; Assurance</span></li>
        <li><span class="ord-num">v.</span><span class="name">Old Testament Reading</span></li>
        <li><span class="ord-num">vi.</span><span class="name">New Testament Reading</span></li>
        <li><span class="ord-num">vii.</span><span class="name">Prayer of the People</span></li>
        <li><span class="ord-num">viii.</span><span class="name">Hymn</span></li>
        <li><span class="ord-num">ix.</span><span class="name">Children dismissed to Children's Church</span></li>
        <li><span class="ord-num">x.</span><span class="name">Sermon &mdash; Rev. Doug Tharp</span></li>
        <li><span class="ord-num">xi.</span><span class="name">The Lord's Supper</span></li>
        <li><span class="ord-num">xii.</span><span class="name">Doxology &amp; Benediction</span></li>`, 'html', 'visit', 'order of worship', 'Bulletin items'],
  ['visit.info.where.title',   'Where we meet', 'text', 'visit', 'practical info', 'Title'],
  ['visit.info.where.body',    'We gather inside Temple Shalom, on the southeast corner of Hillcrest &amp; Alpha. Pull into the south lot and look for our signage. There is plenty of parking; a greeter will be there to point the way.', 'html', 'visit', 'practical info', 'Body'],
  ['visit.info.where.address', '12727 Hillcrest Drive · Dallas, TX 75230', 'text', 'visit', 'practical info', 'Address line'],
  ['visit.info.wear.title',    'What to wear', 'text', 'visit', 'practical info', 'Title'],
  ['visit.info.wear.body',     'There is no dress code. You will see people in suits and people in jeans. Wear what you would wear to dinner at a friend\'s house &mdash; clean enough to honor the day, comfortable enough to be yourself.', 'html', 'visit', 'practical info', 'Body'],
  ['visit.info.communion.title', 'Communion', 'text', 'visit', 'practical info', 'Title'],
  ['visit.info.communion.body',  'We celebrate the Lord\'s Supper every Sunday. The table is open to all baptized Christians who are members in good standing of a gospel-preaching church. Bread is gluten-free; the inner ring of cups contains grape juice.', 'html', 'visit', 'practical info', 'Body'],
  ['visit.info.children.title', 'Your children', 'text', 'visit', 'practical info', 'Title'],
  ['visit.info.children.body',  'Nursery is available throughout the service for infants and toddlers. A toddler Sunday school (18 mo &mdash; 3 yrs) and Elementary Sunday school (grades 3&ndash;5) run from 9:30. Children ages 4 &mdash; 2nd grade are dismissed to Children\'s Church before the sermon.', 'html', 'visit', 'practical info', 'Body'],
  ['visit.after.headline', 'Coffee, conversation, and <span class="display-italic gold">no pressure</span>.', 'html', 'visit', 'after', 'Headline'],
  ['visit.after.body_1',   'After the service we linger in the foyer for coffee. There will be a pastor or elder near the door who would love to meet you. If you\'d rather slip out quietly, that is perfectly fine. We will not make you stand up, raise your hand, or fill out a card.', 'html', 'visit', 'after', 'Paragraph 1'],
  ['visit.after.body_2',   'If you would like to be in touch, drop a note in the offering box or send an email. We\'d be glad to grab coffee during the week.', 'html', 'visit', 'after', 'Paragraph 2'],
  ['visit.faq.body', `<h4 style="margin-bottom: 12px;">Will I be asked to give?</h4>
          <p style="font-size: 15px; color: var(--ink-soft);">No. The offering is for those who call Mercy home. As a guest, please consider yourself our guest.</p>
          <h4 style="margin-bottom: 12px; margin-top: 24px;">How long is the service?</h4>
          <p style="font-size: 15px; color: var(--ink-soft);">About 75 minutes. The sermon is typically 35&ndash;40 minutes.</p>
          <h4 style="margin-bottom: 12px; margin-top: 24px;">Is there a midweek option?</h4>
          <p style="font-size: 15px; color: var(--ink-soft);">Community groups meet across the city throughout the week &mdash; the easiest way to know a few of us better.</p>`, 'html', 'visit', 'FAQ', 'FAQ block'],

  // ---------- About page ----------
  ['about.title',  'About · Mercy Presbyterian Church', 'text', 'about', 'meta', 'Page title'],
  ['about.kicker', 'About Mercy Presbyterian', 'text', 'about', 'head', 'Kicker'],
  ['about.headline', 'A small church, an <span class="em">old gospel</span>.', 'html', 'about', 'head', 'Headline'],
  ['about.deck',     'Founded in 2014. Reformed in tradition, Presbyterian in government, gathered weekly around scripture and the table.', 'text', 'about', 'head', 'Deck'],
  ['about.mission.body', 'Mercy Presbyterian Church is committed to <span class="display-italic" style="color: var(--gold-deep);">glorifying God</span> by preaching, teaching, and living out the Gospel of Jesus Christ &mdash; that the mercies we have received might be carried into Dallas and beyond.', 'html', 'about', 'mission', 'Mission body'],
  ['about.commitments.gathering.title', 'Gathering', 'text', 'about', 'three commitments', 'I. Title'],
  ['about.commitments.gathering.body',  'Gospel-centered worship. We gather weekly to celebrate the gospel through the preached Word, the broken bread, song, prayer, and the giving of ourselves.', 'html', 'about', 'three commitments', 'I. Body'],
  ['about.commitments.gathering.verse', 'Hebrews 10 · 19–25', 'text', 'about', 'three commitments', 'I. Verse'],
  ['about.commitments.growing.title',   'Growing', 'text', 'about', 'three commitments', 'II. Title'],
  ['about.commitments.growing.body',    'Gospel-centered community. We grow together in the grace and the knowledge of the Lord Jesus Christ &mdash; in homes, around tables, and through ordinary friendships.', 'html', 'about', 'three commitments', 'II. Body'],
  ['about.commitments.growing.verse',   '2 Peter 3 · 18', 'text', 'about', 'three commitments', 'II. Verse'],
  ['about.commitments.going.title',     'Going', 'text', 'about', 'three commitments', 'III. Title'],
  ['about.commitments.going.body',      'Gospel-centered kingdom living. We are in the world, not of the world, for the world &mdash; sent to bear witness through word and deed in our neighborhoods and beyond.', 'html', 'about', 'three commitments', 'III. Body'],
  ['about.commitments.going.verse',     'Matthew 5 · 14–16', 'text', 'about', 'three commitments', 'III. Verse'],
  ['about.beliefs.headline', 'The faith once <span class="display-italic gold">delivered</span>.', 'html', 'about', 'beliefs', 'Headline'],
  ['about.beliefs.body_1',   'We hold to the historic Christian faith as articulated in the Apostles\' and Nicene Creeds, and to the Reformed faith as set forth in the Westminster Confession of Faith and the Westminster Shorter and Larger Catechisms. We are members of the Presbyterian Church in America, a confessional Reformed denomination.', 'html', 'about', 'beliefs', 'Paragraph 1'],
  ['about.beliefs.body_2',   'We believe in one God in three persons; in the full deity and full humanity of Jesus Christ; in his death for sinners, his bodily resurrection, his ascension, and his coming again. We believe that the scriptures of the Old and New Testaments are the inspired and inerrant Word of God, our only infallible rule of faith and practice. We believe that salvation is by grace alone, through faith alone, in Christ alone, for the glory of God alone.', 'html', 'about', 'beliefs', 'Paragraph 2'],
  ['about.beliefs.link_1_text', 'Westminster Confession', 'text', 'about', 'beliefs', 'Link 1 text'],
  ['about.beliefs.link_1_url',  'https://www.pcaac.org/bco/westminster-confession/', 'text', 'about', 'beliefs', 'Link 1 URL'],
  ['about.beliefs.link_2_text', 'PCA\'s Book of Church Order', 'text', 'about', 'beliefs', 'Link 2 text'],
  ['about.beliefs.link_2_url',  'https://www.pcaac.org/bco/', 'text', 'about', 'beliefs', 'Link 2 URL'],
  ['about.staff.headline', 'The people who keep the <span class="display-italic gold">work going</span>.', 'html', 'about', 'staff', 'Section headline'],
  ['about.staff.body', `<div class="leader">
        <div class="leader-portrait"><img src="https://www.mercydallas.com/wp-content/uploads/doug-tharp-info.jpg" alt="Doug Tharp" /></div>
        <div class="leader-name">Rev. Doug Tharp</div>
        <div class="leader-role">Senior Pastor</div>
        <div class="leader-bio">Preaches most Sundays. Holds the M.Div. from Reformed Theological Seminary. He and his wife have three children.</div>
      </div>
      <div class="leader">
        <div class="leader-portrait"><span class="initial">A</span></div>
        <div class="leader-name">Alison Thomas</div>
        <div class="leader-role">Ministry Coordinator</div>
        <div class="leader-bio">The voice on the phone and the one who keeps the calendar honest. First point of contact for visitors.</div>
      </div>
      <div class="leader">
        <div class="leader-portrait"><span class="initial">S</span></div>
        <div class="leader-name">Sal Bautista</div>
        <div class="leader-role">Director of Music</div>
        <div class="leader-bio">Leads worship from the piano. Trained as a classical musician; serves both the choir and the congregation.</div>
      </div>
      <div class="leader">
        <div class="leader-portrait"><span class="initial">N</span></div>
        <div class="leader-name">Nate &amp; Cecile Foster</div>
        <div class="leader-role">Youth Directors</div>
        <div class="leader-bio">Open their home to the youth twice a month. Nate also serves as a deacon.</div>
      </div>
      <div class="leader">
        <div class="leader-portrait"><span class="initial">E</span></div>
        <div class="leader-name">Emily Freeman</div>
        <div class="leader-role">Children's Director</div>
        <div class="leader-bio">Oversees nursery through Children's Church. Trains the rotation of volunteers each season.</div>
      </div>
      <div class="leader">
        <div class="leader-portrait"><span class="initial">J</span></div>
        <div class="leader-name">Joanna Dawson</div>
        <div class="leader-role">Women's Director</div>
        <div class="leader-bio">Coordinates the women's Bible studies, mentorship pairs, and the spring &amp; fall retreats.</div>
      </div>`, 'html', 'about', 'staff', 'Staff cards'],
  ['about.elders.intro', 'The elders shepherd the congregation, teach the Word, and guard the doctrine and life of the church. They are nominated by the congregation and ordained for the work.', 'html', 'about', 'elders', 'Elder intro paragraph'],
  ['about.elders.body', `<div class="roster-name">Eric Clay <span class="tag">Clerk</span></div>
          <div class="roster-name">Jeff Dawson</div>
          <div class="roster-name">Clark Morgan</div>
          <div class="roster-name">Rev. Doug Tharp <span class="tag">Teaching</span></div>
          <div class="roster-name">Nathan Murray</div>
          <div class="roster-name">Peyton Bryant</div>
          <div class="roster-name">Blake Edwards</div>
          <div class="roster-name">Thomas Grabow</div>
          <div class="roster-name">Tim Thomason</div>`, 'html', 'about', 'elders', 'Elder roster'],
  ['about.deacons.intro', 'The deacons attend to the bodily needs of the body &mdash; the practical care of the saints, the stewardship of resources, the work of mercy and hospitality.', 'html', 'about', 'deacons', 'Deacon intro paragraph'],
  ['about.deacons.body', `<div class="roster-name">Micah Cunningham <span class="tag">Moderator</span></div>
          <div class="roster-name">Thomas Buerger</div>
          <div class="roster-name">Bryan Hatfield</div>
          <div class="roster-name">Nate Foster</div>
          <div class="roster-name">John Bartel</div>
          <div class="roster-name">Thomas Walter</div>`, 'html', 'about', 'deacons', 'Deacon roster'],
  ['about.pullquote.body', 'A small Reformed church in north Dallas, gathered around <em>the supremacy of Christ</em> and the means of grace he has appointed.', 'html', 'about', 'pull quote', 'Body'],
  ['about.pullquote.attr', 'Mercy Presbyterian · A member of the Presbyterian Church in America', 'text', 'about', 'pull quote', 'Attribution'],

  // ---------- Sermons (placeholder; v2 will replace list with a real table) ----------
  ['sermons.title',  'Sermons · Mercy Presbyterian Church', 'text', 'sermons', 'meta', 'Page title'],
  ['sermons.kicker', 'Sermon archive · 418 sermons · 36 series', 'text', 'sermons', 'head', 'Kicker'],
  ['sermons.headline', 'A long faithfulness <span class="em">in scripture</span>.', 'html', 'sermons', 'head', 'Headline'],
  ['sermons.deck',     'Twelve years of preaching, expository and ordinary. Currently in Hebrews on Sunday mornings.', 'text', 'sermons', 'head', 'Deck'],
  ['sermons.featured.image',        'https://www.mercydallas.com/wp-content/uploads/Hebrews-square-border.png', 'image', 'sermons', 'featured', 'Featured art'],
  ['sermons.featured.image_alt',    'Hebrews: Drawn Near', 'text', 'sermons', 'featured', 'Alt text'],
  ['sermons.featured.series_label', 'Current series', 'text', 'sermons', 'featured', 'Series label'],
  ['sermons.featured.eyebrow_num',  '№ 418', 'text', 'sermons', 'featured', 'Eyebrow number'],
  ['sermons.featured.eyebrow_label','Most recent sermon', 'text', 'sermons', 'featured', 'Eyebrow label'],
  ['sermons.featured.title',        'The full <em>assurance</em> of faith.', 'html', 'sermons', 'featured', 'Title'],
  ['sermons.featured.passage',      'Hebrews 10 · 19–25 · Rev. Doug Tharp · 10 May 2026', 'text', 'sermons', 'featured', 'Passage'],
  ['sermons.featured.summary',      '"Let us draw near with a true heart in full assurance of faith&hellip;"', 'html', 'sermons', 'featured', 'Summary'],
  ['sermons.featured.audio_title',  'The Full Assurance of Faith', 'text', 'sermons', 'featured', 'Audio title'],
  ['sermons.list.body', '<p class="muted" style="padding:48px 0;text-align:center;">The sermon archive is being moved over. Visit <a href="https://www.mercydallas.com/sermons/" style="border-bottom:1px solid var(--gold);">mercydallas.com/sermons</a> in the meantime.</p>', 'html', 'sermons', 'archive list', 'Placeholder body for the sermon list (v1)'],
  ['sermons.list.footer', 'Page 1 of 32 · Subscribe in <a href="#" style="border-bottom: 1px solid var(--gold);">Apple Podcasts</a> · <a href="#" style="border-bottom: 1px solid var(--gold);">Spotify</a> · <a href="#" style="border-bottom: 1px solid var(--gold);">RSS</a>', 'html', 'sermons', 'archive list', 'Footer line under list'],

  // ---------- Groups ----------
  ['groups.title',   'Community Groups · Mercy Presbyterian', 'text', 'groups', 'meta', 'Page title'],
  ['groups.kicker',  'Community groups · eleven homes across the city', 'text', 'groups', 'head', 'Kicker'],
  ['groups.headline','The church <span class="em">at table</span>.', 'html', 'groups', 'head', 'Headline'],
  ['groups.deck',    'A Sunday morning is good. A Tuesday evening in a friend\'s living room is something else. Find a group that fits your life.', 'text', 'groups', 'head', 'Deck'],
  ['groups.intro.body_1', 'Community groups are the heartbeat of our life together. Eight to fifteen people, meeting weekly in a home, eating a meal, opening scripture, praying for one another, carrying one another\'s burdens. They are, in many ways, where the gospel becomes practical &mdash; where the words preached on Sunday meet the actual contours of a Tuesday.', 'html', 'groups', 'intro', 'Paragraph 1'],
  ['groups.intro.body_2', 'You do not need to be a member of Mercy to join one. Most groups meet from late August through early June, taking a break in the summer for less-formal fellowship.', 'html', 'groups', 'intro', 'Paragraph 2'],
  ['groups.list.body', `<div class="group-card" data-tags="north mixed">
        <div class="group-head"><div class="group-name">The Clay Group</div><div class="group-life">Mixed</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Eric &amp; Kate Clay</dd><dt>Where</dt><dd>Preston Hollow &middot; 75230</dd><dt>When</dt><dd>Tuesdays, 7:00 pm</dd><dt>Size</dt><dd>~14 adults &middot; childcare in-home</dd></dl>
        <p class="group-desc">A long-running group that has met for nine years. Slow, generous, and patient with hard questions. Currently working through 1 Peter.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="north families">
        <div class="group-head"><div class="group-name">The Dawson Group</div><div class="group-life">Young families</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Jeff &amp; Joanna Dawson</dd><dt>Where</dt><dd>Lake Highlands &middot; 75238</dd><dt>When</dt><dd>Wednesdays, 6:30 pm</dd><dt>Size</dt><dd>6 families &middot; kids welcome &amp; loud</dd></dl>
        <p class="group-desc">Pizza, then a brief study, then prayer. The children play in the back yard. Built for parents in the throes.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="uptown young-pros">
        <div class="group-head"><div class="group-name">The Bryant Group</div><div class="group-life">Young professionals</div></div>
        <dl class="group-meta"><dt>Host</dt><dd>Peyton Bryant</dd><dt>Where</dt><dd>Uptown &middot; 75201</dd><dt>When</dt><dd>Thursdays, 7:30 pm</dd><dt>Size</dt><dd>~10 &middot; singles &amp; young marrieds</dd></dl>
        <p class="group-desc">A group of twenty- and thirty-somethings, mostly working downtown. Quick discussion, late conversation, real friendships.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="east mixed">
        <div class="group-head"><div class="group-name">The Edwards Group</div><div class="group-life">Mixed</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Blake &amp; Hannah Edwards</dd><dt>Where</dt><dd>M Streets &middot; 75206</dd><dt>When</dt><dd>Wednesdays, 7:00 pm</dd><dt>Size</dt><dd>~12 adults</dd></dl>
        <p class="group-desc">An East Dallas group with a wide age range. Studies follow the Sunday sermon when possible.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="suburb families">
        <div class="group-head"><div class="group-name">The Grabow Group</div><div class="group-life">Young families</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Thomas &amp; Beth Grabow</dd><dt>Where</dt><dd>Plano &middot; 75024</dd><dt>When</dt><dd>Tuesdays, 6:30 pm</dd><dt>Size</dt><dd>5 families &middot; childcare on-site</dd></dl>
        <p class="group-desc">A north-of-the-tollway option for families who'd rather not drive all the way down on a school night.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="north empty-nest">
        <div class="group-head"><div class="group-name">The Morgan Group</div><div class="group-life">Empty-nesters</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Clark &amp; Linda Morgan</dd><dt>Where</dt><dd>Preston Hollow &middot; 75230</dd><dt>When</dt><dd>Sundays, 5:00 pm</dd><dt>Size</dt><dd>~10 adults &middot; dinner together</dd></dl>
        <p class="group-desc">A Sunday evening group for those whose children have left the house. Currently in the Pastoral Epistles.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="east young-pros">
        <div class="group-head"><div class="group-name">The Thomason Group</div><div class="group-life">Young professionals</div></div>
        <dl class="group-meta"><dt>Host</dt><dd>Tim Thomason</dd><dt>Where</dt><dd>Lower Greenville &middot; 75214</dd><dt>When</dt><dd>Mondays, 7:30 pm</dd><dt>Size</dt><dd>~8 &middot; singles, mostly</dd></dl>
        <p class="group-desc">A Monday option in East Dallas. Small, scrappy, and warmly skeptical of formality. New folks especially welcome.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="group-card" data-tags="north mixed">
        <div class="group-head"><div class="group-name">The Murray Group</div><div class="group-life">Mixed</div></div>
        <dl class="group-meta"><dt>Hosts</dt><dd>Nathan &amp; Sarah Murray</dd><dt>Where</dt><dd>Far North Dallas &middot; 75252</dd><dt>When</dt><dd>Thursdays, 7:00 pm</dd><dt>Size</dt><dd>~12 adults</dd></dl>
        <p class="group-desc">An open table on the north side. Discussion-heavy. Currently reading <em>Honest Evangelism</em> together.</p>
        <div class="group-actions"><a href="#" class="link-arrow">Visit this group <span class="arrow">&rarr;</span></a></div>
      </div>`, 'html', 'groups', 'group list', 'Group cards (HTML)'],
  ['groups.help.headline', 'We\'d be glad to <span class="display-italic gold">walk you in</span>.', 'html', 'groups', 'help', 'Headline'],
  ['groups.help.body', 'The first visit can be the hardest. Send us a note &mdash; let us know roughly where you live and what stage of life you\'re in, and we\'ll suggest one or two groups and let the host know to look for you. There is no commitment to keep coming back.', 'html', 'groups', 'help', 'Body'],

  // ---------- Events ----------
  ['events.title',   'Calendar · Mercy Presbyterian', 'text', 'events', 'meta', 'Page title'],
  ['events.kicker',  'The church calendar · May & June MMXXVI', 'text', 'events', 'head', 'Kicker'],
  ['events.headline','When we\'ll <span class="em">be together</span>.', 'html', 'events', 'head', 'Headline'],
  ['events.deck',    'Sundays, studies, retreats, dinners, and the occasional work day. Filter by ministry; subscribe to your phone.', 'text', 'events', 'head', 'Deck'],
  ['events.list.body', `<div class="section-label" style="margin-top: 0;"><span class="roman">May</span><span>MMXXVI</span></div>
    <div class="events-list">
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">14</span><span class="weekday">Thursday</span></div>
        <div class="event-body">
          <h3>Women's evening Bible study</h3>
          <div class="event-meta"><span>7:30 pm</span><span class="sep">&middot;</span><span>Fellowship Hall</span><span class="sep">&middot;</span><span>Childcare provided</span></div>
          <p>Week six of <em>Honest Evangelism</em> by Rico Tice. New attendees welcome &mdash; you do not need to have read the prior chapters.</p>
        </div>
        <div class="event-cta"><a href="#" class="btn">Register <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">17</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>The Lord's Day <em>&middot; Morning worship</em></h3>
          <div class="event-meta"><span>10:00 am</span><span class="sep">&middot;</span><span>Sanctuary</span><span class="sep">&middot;</span><span>Communion served</span></div>
          <p>Hebrews 10:19&ndash;25. Children's church for ages 4 &mdash; 2nd grade dismissed before the sermon. Sunday school at 9:30.</p>
        </div>
        <div class="event-cta"><a href="#" class="link-arrow">Order of worship <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">20</span><span class="weekday">Wednesday</span></div>
        <div class="event-body">
          <h3>Men's breakfast &amp; prayer</h3>
          <div class="event-meta"><span>6:30 am</span><span class="sep">&middot;</span><span>Fellowship Hall</span></div>
          <p>Coffee, eggs, and intercession before the work day begins. No agenda beyond honest prayer for one another and the church.</p>
        </div>
        <div class="event-cta"><a href="#" class="btn">RSVP <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">24</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>Youth night <em>&middot; grades 6&ndash;12</em></h3>
          <div class="event-meta"><span>5:30 pm</span><span class="sep">&middot;</span><span>Foster home</span><span class="sep">&middot;</span><span>Dinner provided</span></div>
          <p>Discussion on the Beatitudes. Bring a friend &mdash; new folks always welcome.</p>
        </div>
        <div class="event-cta"><a href="#" class="link-arrow">Details <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">May</span><span class="day tabular">31</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>Members' meeting</h3>
          <div class="event-meta"><span>11:45 am</span><span class="sep">&middot;</span><span>Sanctuary</span><span class="sep">&middot;</span><span>Lunch served</span></div>
          <p>Quarterly congregational meeting. Election of new officers, financial update, and prayer for the year ahead.</p>
        </div>
        <div class="event-cta"><a href="#" class="link-arrow">Details <span class="arrow">&rarr;</span></a></div>
      </div>
    </div>
    <div class="section-label" style="margin-top: 80px;"><span class="roman">June</span><span>MMXXVI</span></div>
    <div class="events-list">
      <div class="event-row">
        <div class="event-date"><span class="month">Jun</span><span class="day tabular">06</span><span class="weekday">Saturday</span></div>
        <div class="event-body">
          <h3>Women's brunch &amp; spring tea</h3>
          <div class="event-meta"><span>10:00 am</span><span class="sep">&middot;</span><span>The Dawson home</span><span class="sep">&middot;</span><span>$15 &middot; childcare available</span></div>
          <p>The end-of-spring tradition. A morning of unhurried conversation, scones, and the launch of the summer reading list.</p>
        </div>
        <div class="event-cta"><a href="#" class="btn">Register <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">Jun</span><span class="day tabular">13</span><span class="weekday">Saturday</span></div>
        <div class="event-body">
          <h3>Mercy in Dallas <em>&middot; service day</em></h3>
          <div class="event-meta"><span>9:00 am &mdash; 1:00 pm</span><span class="sep">&middot;</span><span>Casa Del Lago</span><span class="sep">&middot;</span><span>Lunch provided</span></div>
          <p>A morning serving alongside Casa Del Lago in West Dallas. All ages welcome &mdash; tasks for everyone from energetic six-year-olds to grandparents.</p>
        </div>
        <div class="event-cta"><a href="#" class="btn">Sign up <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">Jun</span><span class="day tabular">21</span><span class="weekday">Sunday</span></div>
        <div class="event-body">
          <h3>The Lord's Day <em>&middot; Father's Day</em></h3>
          <div class="event-meta"><span>10:00 am</span><span class="sep">&middot;</span><span>Sanctuary</span></div>
          <p>Hebrews 11. We will pray for fathers and for the fatherless.</p>
        </div>
        <div class="event-cta"><a href="#" class="link-arrow">Details <span class="arrow">&rarr;</span></a></div>
      </div>
      <div class="event-row">
        <div class="event-date"><span class="month">Jun</span><span class="day tabular">26</span><span class="weekday">Friday</span></div>
        <div class="event-body">
          <h3>Youth retreat <em>&middot; Cedar Hill</em></h3>
          <div class="event-meta"><span>Fri evening &mdash; Sun afternoon</span><span class="sep">&middot;</span><span>Cedar Hill State Park</span><span class="sep">&middot;</span><span>$95 &middot; scholarships available</span></div>
          <p>Three days of teaching, hiking, lake-swimming, and late-night campfires. Led by Nate &amp; Cecile Foster, with three guest counselors.</p>
        </div>
        <div class="event-cta"><a href="#" class="btn">Register <span class="arrow">&rarr;</span></a></div>
      </div>
    </div>`, 'html', 'events', 'event list', 'Full event list HTML'],
  ['events.recurring.sunday.eyebrow', 'Every Sunday', 'text', 'events', 'recurring', 'Sunday eyebrow'],
  ['events.recurring.sunday.title',   'Morning worship <em>· 10:00</em>', 'html', 'events', 'recurring', 'Sunday title'],
  ['events.recurring.sunday.body',    'Plus Sunday school at 9:30 (toddler, elementary, and adult). Coffee and conversation in the foyer afterward.', 'html', 'events', 'recurring', 'Sunday body'],
  ['events.recurring.groups.eyebrow', 'Tue / Wed / Thu', 'text', 'events', 'recurring', 'Groups eyebrow'],
  ['events.recurring.groups.title',   'Community groups', 'html', 'events', 'recurring', 'Groups title'],
  ['events.recurring.groups.body',    'Eight groups across Dallas, meeting in homes throughout the week. <a href="/groups" style="border-bottom: 1px solid var(--gold);">Find one near you &rarr;</a>', 'html', 'events', 'recurring', 'Groups body'],
  ['events.recurring.women.eyebrow',  'Wed evenings', 'text', 'events', 'recurring', 'Women eyebrow'],
  ['events.recurring.women.title',    'Women\'s Bible study', 'html', 'events', 'recurring', 'Women title'],
  ['events.recurring.women.body',     '9:30am or 7:30pm. Currently working through <em>Honest Evangelism</em>. Childcare in the mornings.', 'html', 'events', 'recurring', 'Women body'],

  // ---------- Give ----------
  ['give.title',   'Give · Mercy Presbyterian', 'text', 'give', 'meta', 'Page title'],
  ['give.kicker',  'Stewardship', 'text', 'give', 'head', 'Kicker'],
  ['give.headline','Give as you have been <span class="em">given to</span>.', 'html', 'give', 'head', 'Headline'],
  ['give.deck',    'Mercy is sustained by the generosity of its members. Below is the giving page; the box on the right will take you to our secure giving partner.', 'html', 'give', 'head', 'Deck'],
  ['give.why.body_1', 'The first reason we give is not that the church needs it &mdash; though it does &mdash; but that we have been given a gift unmeasurable. The Father did not spare his own Son. The Son spent his life for our sake. The Spirit takes up residence in clay. We give because we have been given to.', 'html', 'give', 'why we give', 'Paragraph 1'],
  ['give.why.body_2', 'The second reason is simpler: a local church is a local thing, and local things require care. Rent, salaries, music, supplies for the children\'s ministry, the mid-week light bill, the deacons\' fund for the family who lost a job last month. Our budget is not lavish, but it is real, and it is yours.', 'html', 'give', 'why we give', 'Paragraph 2'],
  ['give.why.body_3', 'A note for guests: please consider yourself our guest. The offering is for those who call Mercy home.', 'html', 'give', 'why we give', 'Paragraph 3'],
  ['give.allocation.body', `<dt>Pastoral &amp; staff support</dt><dd class="tabular muted">~52%</dd>
            <dt>Facilities &amp; operations</dt><dd class="tabular muted">~18%</dd>
            <dt>Mission partners</dt><dd class="tabular muted">~12%</dd>
            <dt>Ministry programs</dt><dd class="tabular muted">~10%</dd>
            <dt>Diaconal fund &amp; mercy</dt><dd class="tabular muted">~5%</dd>
            <dt>Denominational support (PCA)</dt><dd class="tabular muted">~3%</dd>`, 'html', 'give', 'allocation', 'Allocation rows (dt/dd pairs)'],
  ['give.allocation.note', 'Approximate annual allocation. Annual financial summaries are available to members in the members area. We are happy to walk anyone through the budget in person.', 'html', 'give', 'allocation', 'Footnote'],
  ['give.form.subhead', 'A one-time or recurring gift.', 'text', 'give', 'giving form', 'Subhead'],
  ['give.form.giving_url', 'https://mercydallas.churchcenter.com/giving', 'text', 'give', 'giving form', 'External giving partner URL'],
  ['give.form.footnote', 'Processed by Church Center · PCI compliant · Tax-deductible', 'text', 'give', 'giving form', 'Footnote under button'],
  ['give.other_ways.body', `<li><strong>By mail:</strong> Mercy Presbyterian Church, 12727 Hillcrest Drive, Dallas, TX 75230</li>
            <li style="margin-top: 8px;"><strong>By stock or DAF:</strong> contact <a href="mailto:church@mercydallas.com" style="border-bottom: 1px solid var(--gold);">church@mercydallas.com</a></li>
            <li style="margin-top: 8px;"><strong>Bequest planning:</strong> the elders are glad to talk it through</li>`, 'html', 'give', 'other ways', 'Other ways list'],
  ['give.pullquote.body', 'Each one must give as he has decided in his heart, <em>not reluctantly or under compulsion</em>, for God loves a cheerful giver.', 'html', 'give', 'pull quote', 'Verse body'],
  ['give.pullquote.attr', '2 Corinthians 9 · 7', 'text', 'give', 'pull quote', 'Citation'],
];

function seed() {
  const db = new Database(config.databasePath);
  try { db.pragma('journal_mode = WAL'); } catch (_e) { db.pragma('journal_mode = DELETE'); }

  const insert = db.prepare(`
    INSERT INTO content (key, value, kind, page, section, label, sort_order)
    VALUES (@key, @value, @kind, @page, @section, @label, @sort_order)
    ON CONFLICT(key) DO UPDATE SET
      kind = excluded.kind,
      page = excluded.page,
      section = excluded.section,
      label = excluded.label,
      sort_order = excluded.sort_order
  `);

  const tx = db.transaction(() => {
    let i = 0;
    for (const row of SEED) {
      const [key, value, kind, page, section, label] = row;
      insert.run({ key, value, kind, page, section, label, sort_order: i++ });
    }
  });
  tx();

  const count = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  console.log(`seeded: ${SEED.length} keys (table now has ${count} rows)`);
  db.close();
}

if (require.main === module) {
  try { seed(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { seed };
