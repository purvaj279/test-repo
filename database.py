import sqlite3
import os
from datetime import datetime
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), "wanderlore.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(force_reseed=False):
    conn = get_db_connection()
    cursor = conn.cursor()

    if force_reseed:
        cursor.execute("DROP TABLE IF EXISTS trip_waypoints")
        cursor.execute("DROP TABLE IF EXISTS trips")
        cursor.execute("DROP TABLE IF EXISTS reservations")
        cursor.execute("DROP TABLE IF EXISTS contact_submissions")
        cursor.execute("DROP TABLE IF EXISTS users")
        cursor.execute("DROP TABLE IF EXISTS spots")
        cursor.execute("DROP TABLE IF EXISTS field_notes")
        cursor.execute("DROP TABLE IF EXISTS expeditions")
        cursor.execute("DROP TABLE IF EXISTS user_profiles")
        cursor.execute("DROP TABLE IF EXISTS user_bookmarks")
        cursor.execute("DROP TABLE IF EXISTS community_discussions")

    # 1. Users Table with Secure Password Hashing and Reset Tokens
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT DEFAULT '',
        title TEXT DEFAULT 'Wanderer',
        bio TEXT DEFAULT '',
        role TEXT DEFAULT 'explorer',
        reset_token TEXT DEFAULT NULL,
        reset_token_expiry TEXT DEFAULT NULL,
        created_at TEXT NOT NULL
    )
    """)

    # 2. Trips / Itineraries Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        budget REAL DEFAULT 0.0,
        status TEXT DEFAULT 'Upcoming',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # 3. Trip Waypoints Table (with latitude, longitude, and day sequence)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trip_waypoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL,
        spot_id INTEGER DEFAULT NULL,
        title TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        day_number INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
        FOREIGN KEY (spot_id) REFERENCES spots (id) ON DELETE SET NULL
    )
    """)

    # 4. Reservations / Bookings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        spot_id INTEGER DEFAULT NULL,
        expedition_id INTEGER DEFAULT NULL,
        booking_reference TEXT UNIQUE NOT NULL,
        booking_type TEXT NOT NULL,
        travel_date TEXT NOT NULL,
        party_size INTEGER NOT NULL,
        total_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'Confirmed',
        special_requests TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (spot_id) REFERENCES spots (id) ON DELETE SET NULL,
        FOREIGN KEY (expedition_id) REFERENCES expeditions (id) ON DELETE SET NULL
    )
    """)

    # 5. Contact & Concierge Submissions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS contact_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'New',
        created_at TEXT NOT NULL
    )
    """)

    # 6. Sanctuaries / Spots Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS spots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL,
        region TEXT NOT NULL,
        country TEXT NOT NULL,
        category TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        image_url TEXT NOT NULL,
        lore TEXT NOT NULL,
        solitude_score INTEGER NOT NULL,
        decibel_level INTEGER NOT NULL,
        crowd_factor TEXT NOT NULL,
        cell_signal TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        best_season TEXT NOT NULL,
        leave_no_trace_notes TEXT NOT NULL,
        guardian_name TEXT NOT NULL,
        guardian_title TEXT NOT NULL,
        riddle_question TEXT,
        riddle_answer TEXT,
        riddle_hint TEXT,
        is_protected INTEGER DEFAULT 0,
        soundscape_type TEXT DEFAULT 'forest_wind',
        upvotes INTEGER DEFAULT 0,
        permit_price REAL DEFAULT 15.0,
        created_at TEXT NOT NULL
    )
    """)

    # 7. Field Notes Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS field_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spot_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        author_badge TEXT NOT NULL,
        note_type TEXT NOT NULL,
        content TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (spot_id) REFERENCES spots (id)
    )
    """)

    # 8. Expeditions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS expeditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        destination_name TEXT NOT NULL,
        region TEXT NOT NULL,
        organizer_name TEXT NOT NULL,
        organizer_badge TEXT NOT NULL,
        expedition_date TEXT NOT NULL,
        skill_level TEXT NOT NULL,
        max_participants INTEGER NOT NULL,
        current_participants INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)

    # 9. User Profiles (Personalization state)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        title TEXT NOT NULL,
        badge TEXT NOT NULL,
        bio TEXT NOT NULL,
        avatar_icon TEXT NOT NULL,
        preferred_categories TEXT NOT NULL,
        min_solitude_pref INTEGER DEFAULT 80,
        max_decibel_pref INTEGER DEFAULT 25,
        leave_no_trace_pledged INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)

    # 10. Bookmarks Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        spot_id INTEGER NOT NULL,
        personal_note TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(username, spot_id),
        FOREIGN KEY (spot_id) REFERENCES spots (id)
    )
    """)

    # 11. Discussions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS community_discussions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_badge TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        replies_count INTEGER DEFAULT 0,
        upvotes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """)

    cursor.execute("SELECT COUNT(*) FROM spots")
    if cursor.fetchone()[0] == 0 or force_reseed:
        seed_data(cursor)

    conn.commit()
    conn.close()

def seed_data(cursor):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Seed Default Production Users
    demo_password_hash = generate_password_hash("password123")

    users_data = [
        (
            "purvaj@wanderlore.com",
            demo_password_hash,
            "Purvaj",
            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
            "Astro-Backpacker & High Solitude Seeker",
            "Dedicated to charting sanctuaries with zero light pollution, extreme acoustic tranquility, and respectful zero-trace ethics.",
            "explorer",
            now
        ),
        (
            "maya@wanderlore.com",
            demo_password_hash,
            "Maya Lin",
            "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80",
            "Botanical Custodian & Ethno-Botanist",
            "Researches living root architecture and indigenous forest protocols across monsoon valleys.",
            "guardian",
            now
        ),
        (
            "kenji@wanderlore.com",
            demo_password_hash,
            "Kenji Sato",
            "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
            "Subterranean Geologist",
            "Exploring basalt acoustic canyon resonance, volcanic calderas, and abandoned stone settlements.",
            "explorer",
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO users (email, password_hash, display_name, avatar_url, title, bio, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, users_data)

    # 12 Deeply Curated Offbeat Sanctuaries
    spots_data = [
        (
            "The Sunken Bell of Mavrovo",
            "A forgotten submerged church whose bell tower rises eerily from alpine waters",
            "Mavrovo National Park",
            "North Macedonia",
            "Forgotten Ruins",
            41.7103,
            20.7601,
            "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80",
            "Submerged in 1953 during the creation of an artificial lake, the 19th-century Church of Saint Nicholas stays partially drowned in snowmelt. In late summer when water levels drop, the stone nave re-emerges coated in dry silt and wild lilies. At twilight, the mountain winds funnel through the hollow bell tower, producing low resonant tones heard across the deserted shoreline.",
            94,
            21,
            "1 to 4 wandering shepherds or kayakers per week",
            "0 Bars - Total Blackout (Alpine Valley Shadow)",
            "Moderate Shoreline Trek / Packraft",
            "Late August to October (Low Water Season)",
            "Do not enter the roofless bell tower; mortar is unstable. Kayak landing only on rocky gravel to protect endemic lakeside salamanders.",
            "Goran Jovanovski",
            "Alpine Lake Guardian & Historian",
            "What creature sleeps under the dried altar during September moonlights?",
            "salamander",
            "A harmless semi-aquatic amphibian with black-and-gold skin mentioned in the field notes.",
            1,
            "water_gentle",
            142,
            12.0,
            now
        ),
        (
            "The Singing Basalt Flutes of Hljóðaklettar",
            "Echoing volcanic honeycomb canyons where sound spirals in impossible acoustic loops",
            "Jökulsárgljúfur Canyon",
            "Iceland",
            "Subterranean & Geo",
            65.9333,
            -16.5167,
            "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=1200&q=80",
            "Hljóðaklettar ('Echo Rocks') is a cluster of columnar basalt formations twisted into spiral rosettes and beehives. Because the basalt columns face inward in conflicting angles, human whispers reflect 300 meters across the volcanic gorge without losing clarity, while footsteps get silenced instantly by porous volcanic tephra.",
            91,
            16,
            "Zero scheduled tours. 2-5 independent trekkers daily",
            "1 Bar on high rim, 0 in the canyon floor",
            "Rugged Volcanic Scramble",
            "June to September (Access road impassable in winter)",
            "Stick strictly to the red marker stones; delicate Arctic crust lichens take 80 years to regrow if stepped on.",
            "Astrid Lindholm",
            "Vatnajökull Wilderness Ranger",
            "What natural volcanic rock forms into hexagonal columns?",
            "basalt",
            "A dark, fine-grained volcanic rock formed into hexagonal columns.",
            0,
            "canyon_wind",
            189,
            18.0,
            now
        ),
        (
            "The Starlit Petroglyphs of Anza-Borrego",
            "Centuries-old desert rock etchings under a certified Class 1 Bortle dark sky",
            "Colorado Desert, California",
            "United States",
            "Stargazing Sanctuaries",
            33.2560,
            -116.3752,
            "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80",
            "Tucked deep inside a dry slot canyon 14 miles off unpaved washboard roads, Kumeyaay solar solstice markings align with needle-eye granite boulders. When the Milky Way arches overhead at 2:00 AM, the temperature drops 30 degrees and the silence is so deep you can hear the beating of raven wings half a mile away.",
            97,
            14,
            "Under 2 people per 48 hours; zero light pollution",
            "Zero cellular reception for 18 miles",
            "Desert Navigation / High-Clearance 4x4",
            "November through March",
            "Pack out all human waste. Never touch petroglyphs with bare hands; skin oils degrade prehistoric mineral varnish.",
            "Elena Ortiz",
            "Desert Night Sky Conservator",
            "Which indigenous nation carved the solar petroglyphs into the granite?",
            "kumeyaay",
            "The ancestral native people of southwestern California and northern Baja.",
            1,
            "night_crickets",
            215,
            15.0,
            now
        ),
        (
            "The Living Root Bridges of Nohwet",
            "A secluded centuries-old aerial canopy bridge nurtured across an untouched gorge",
            "East Khasi Hills, Meghalaya",
            "India",
            "Sacred Groves",
            25.1974,
            91.8902,
            "https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=1200&q=80",
            "While tourists flock to the commercial double-decker root bridge of Cherrapunji, Nohwet remains a sacred whisper. Woven over 200 years from the aerial roots of Ficus elastica by Khasi village elders, this mossy green bridge arches across a crystal-emerald river bed surrounded by sacred betel groves.",
            88,
            24,
            "Local villagers gathering spices; 1-2 visitors weekly",
            "1 Bar BSNL intermittent",
            "Steep Stone Steps (1,200 vertical limestone steps)",
            "October to April (avoid raging monsoons)",
            "Remove leather shoes before stepping on the sacred bridge roots as requested by the village headman.",
            "Daphne Lyngdoh",
            "Khasi Elder & Sacred Grove Steward",
            "What genus of fig tree's aerial roots form this living architectural wonder?",
            "ficus",
            "Also known as the rubber fig or Indian rubber plant.",
            1,
            "jungle_stream",
            310,
            10.0,
            now
        ),
        (
            "The Ghost Village of Craco",
            "A medieval limestone citadel perched precariously over desolate clay ravines",
            "Basilicata",
            "Italy",
            "Ghost Towns",
            40.3789,
            16.4411,
            "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=80",
            "Perched atop a 400-meter cliff above the badlands of Lucania, Craco was founded in the 8th century and abandoned after catastrophic geological landslides in the 1960s. The empty arched courtyards and aristocratic palaces whistle in the Sirocco winds, overlooking clay gullies resembling the surface of the moon.",
            86,
            22,
            "Occasional preservationist; zero commercial shops",
            "Spotty 3G near lower road; dead zone in citadel",
            "Moderate Uphill Incline; Sturdy Boots Required",
            "April to June or September to November",
            "Do not climb crumbling balcony walls. Hard hats recommended due to falling tuff stone fragments.",
            "Marco Bellini",
            "Lucanian Cultural Heritage Watch",
            "In which decade was the medieval citadel completely evacuated due to tremors?",
            "1960s",
            "The era of the moon landing and rock n roll (between 1960 and 1969).",
            0,
            "canyon_wind",
            174,
            14.0,
            now
        ),
        (
            "The Obsidian Oasis of Askja",
            "A geothermal milky-blue caldera cradle inside a pitch-black lunar lava wilderness",
            "Dyngjufjöll Mountains",
            "Iceland",
            "Subterranean & Geo",
            65.0292,
            -16.7584,
            "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
            "Deep inside the highlands where Apollo 11 astronauts trained for lunar geology, Lake Víti rests inside a crater blasted open in 1875. The mineral-rich warm sulfur waters glow an ethereal milky turquoise against black volcanic glass boulders. Total acoustic silence envelops the caldera when winds settle.",
            96,
            15,
            "Zero crowds; seasonal 4x4 highland expeditioners only",
            "Zero Bars (Satellite phone strictly necessary)",
            "Challenging Highland Trek across Pumice Fields",
            "Mid-July to Late August only",
            "Strictly follow geothermal safety ropes; sub-surface steam vents can cause fatal burns beneath false crust.",
            "Thorir Sigurdsson",
            "Highland Search & Conservation Warden",
            "Which NASA space mission trained its astronauts on this lunar-like volcanic terrain?",
            "apollo",
            "The historic American moon exploration program.",
            1,
            "mountain_breeze",
            254,
            25.0,
            now
        ),
        (
            "The Whispering Cedar Scriptorium of Qadisha",
            "Ancient cliff-face hermitage carved into sheer limestone gorges beside millennial cedars",
            "Qadisha Holy Valley",
            "Lebanon",
            "Forgotten Ruins",
            34.2494,
            35.9525,
            "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1200&q=80",
            "Hanging suspended 300 meters above a forested limestone gorge, Saint Anthony of Qozhaya is one of the oldest monastic sanctuaries in the Middle East. It houses the region's first 16th-century Gutenberg-style movable type printing press in an echoing cavern where wild mountain water drips into hand-chiseled stone basins.",
            92,
            19,
            "A solitary hermit monk and occasional local orchardist",
            "Zero cellular reception inside the cliff cavern",
            "Old Mule Track with Exposed Cliffside Drops",
            "May to June or September to October",
            "Maintain complete contemplative silence inside the cavern. Respect the orchard boundary stone walls.",
            "Fr. Boutros Antoun",
            "Qadisha Hermitage Custodian",
            "What groundbreaking 16th-century machine is preserved inside the cavern scriptorium?",
            "printing press",
            "Movable type mechanical device used to produce religious manuscripts.",
            0,
            "water_gentle",
            198,
            10.0,
            now
        ),
        (
            "The Emerald Cenote of the Bat Lords",
            "An underground subterranean sinkhole hidden deep within Mayan jungle vines",
            "Yucatán Peninsula",
            "Mexico",
            "Subterranean & Geo",
            20.6843,
            -88.5678,
            "https://images.unsplash.com/photo-1518457607834-6e8d80c183c5?auto=format&fit=crop&w=1200&q=80",
            "Located 6 miles through untracked selva foliage away from resort coach lines, this semi-collapsed limestone vault features a single 2-foot roof fissure. Exactly at 11:45 AM on sunny days, a solitary laser-straight sunbeam strikes the 90-foot turquoise water below, illuminating blind cave fish and prehistoric stalactites.",
            95,
            18,
            "Guarded by an ejido cooperative; limited to 6 souls a day",
            "Zero Bars (Dense jungle canopy)",
            "Rope Ladder Descent & Dark Cavern Swim",
            "November to April (Dry Season)",
            "Strict chemical prohibition: zero sunscreen or bug spray allowed in water to preserve pristine aquifer purity.",
            "Mateo Chan",
            "Mayan Ejido Water Guardian",
            "What personal care skin cream is strictly banned before swimming to protect the pristine aquifer?",
            "sunscreen",
            "UV lotion that leaves oily chemicals in freshwater limestone pools.",
            1,
            "jungle_stream",
            283,
            20.0,
            now
        ),
        (
            "The Singing Sands of Al-Badayer",
            "Remote shifting crescent dunes producing deep low-frequency acoustic vibrations in twilight",
            "Sharjah Desert Fringe",
            "United Arab Emirates",
            "Stargazing Sanctuaries",
            24.9658,
            55.7725,
            "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=1200&q=80",
            "When warm evening winds cascade sand grains over the knife-edge crest of these 100-meter golden barchan dunes, the frictional acoustic resonance generates an eerie drone reminiscent of a didgeridoo. Far beyond dune-buggy circuits, nightfall brings absolute silence and brilliant Orion constellations.",
            93,
            17,
            "Solitary Bedouin camel train once a month",
            "0 to 1 Bar on dune ridge only",
            "Deep Sand Navigation / Camel Trek",
            "November to February",
            "No vehicular motor access permitted within the acoustic sanctuary perimeter. Pack all hydration bladders back.",
            "Rashid Al-Nuaimi",
            "Desert Ecology Custodian",
            "What instrument's low drone does the resonance of shifting sand grains resemble?",
            "didgeridoo",
            "An Australian wind instrument known for deep continuous harmonic drones.",
            1,
            "canyon_wind",
            167,
            15.0,
            now
        ),
        (
            "The Moss-Crowned Dolmens of Marayoor",
            "Neolithic stone burial megaliths nestled amidst fragrant wild sandalwood forests",
            "Western Ghats, Kerala",
            "India",
            "Sacred Groves",
            10.2796,
            77.1604,
            "https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=1200&q=80",
            "Scattered across high mist-draped granite terraces, over 2,000 chambered megaliths date back to 10,000 BCE. The monolithic slabs are held upright without mortar, wrapped in wet lichen and wild lemon grass, looking down over clouds lingering in the sandalwood valleys.",
            89,
            20,
            "Muduvan tribal forest gatherers; no commercial tour buses",
            "1 Bar Emergency on High Hilltop",
            "Forested Incline & Stream Crossings",
            "September to March",
            "Do not deface or stand on the capstones. Sandalwood trees are legally protected; do not harvest bark or roots.",
            "Rajan Muthu",
            "Ghats Tribal Elder & Megalith Keeper",
            "How many millennia BCE do these neolithic chambered megaliths date back to?",
            "10000",
            "The end of the last Ice Age (ten thousand years BCE).",
            0,
            "forest_wind",
            230,
            8.0,
            now
        ),
        (
            "The Sky Monasteries of Tatev Hermits",
            "An abandoned 17th-century cloister hidden in a dense oak ravine below vertical canyon walls",
            "Vorotan Gorge",
            "Armenia",
            "Forgotten Ruins",
            39.3792,
            46.2575,
            "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80",
            "While tourists ride the aerial tramway overhead, the Great Hermitage of Tatev lies forgotten down on the gorge floor. Basalt basilicas and subterranean refectories are half-buried under walnut trees and wild hops. In the center courtyard, a freshwater spring still flows into an ancient stone baptismal pool.",
            90,
            19,
            "Local beekeeper and wild herb foragers",
            "0 Bars inside the deep canyon cleft",
            "Steep Switchback Mule Track (400m descent)",
            "May to July and September to October",
            "Watch for loose basalt blocks around dome collapses. Respect the active beehives kept by the canyon wardens.",
            "Hakob Melikyan",
            "Vorotan Canyon Conservation Trust",
            "What tree fruit canopy partially shades the sunken courtyard refectory?",
            "walnut",
            "A round single-seeded stone fruit tree prized for its brain-shaped nut.",
            1,
            "water_gentle",
            176,
            12.0,
            now
        ),
        (
            "The Bioluminescent Lagoon of Laguna Grande",
            "A pitch-black mangrove estuary that glows electric cobalt with every quiet paddle stroke",
            "Fajardo Coastal Forest Reserve",
            "Puerto Rico",
            "Sacred Groves",
            18.3750,
            -65.6250,
            "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80",
            "Under an arching tunnel of red mangrove branches, this secluded lagoon holds one of the rarest concentrations of Pyrodinium bahamense dinoflagellates on Earth. Away from motorboats in the zero-light-pollution eastern arm, dipping an oar creates spirals of turquoise starlight beneath the silent water.",
            94,
            16,
            "Restricted to 8 silent human-powered kayaks per night",
            "0 Bars in deep mangrove tunnel",
            "Nighttime Sea Kayak Navigation",
            "Year-round on New Moon nights",
            "Motorboats strictly forbidden. No swimming permitted to protect delicate dinoflagellate microorganisms.",
            "Carmen Morales",
            "Marine Bioluminescence Warden",
            "What microscopic single-celled organism causes the water to glow turquoise?",
            "dinoflagellate",
            "Marine plankton that emit bioluminescent blue light when agitated.",
            1,
            "water_gentle",
            268,
            22.0,
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO spots (
        name, tagline, region, country, category, latitude, longitude, image_url, lore,
        solitude_score, decibel_level, crowd_factor, cell_signal, difficulty, best_season,
        leave_no_trace_notes, guardian_name, guardian_title, riddle_question, riddle_answer,
        riddle_hint, is_protected, soundscape_type, upvotes, permit_price, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, spots_data)

    # Seed Sample Itineraries & Waypoints for Purvaj (user_id = 1)
    trips_data = [
        (
            1,
            "Solstice Stargazing & Desert Silence",
            "Colorado Desert, California",
            "2026-11-14",
            "2026-11-17",
            450.0,
            "Upcoming",
            "Four-day off-grid desert crossing with high-clearance 4x4. Focus on Bortle 1 night photography and ancient petroglyphs.",
            now
        ),
        (
            1,
            "Nordic Basalt & Volcanic Acoustics",
            "Highlands of Iceland",
            "2027-07-10",
            "2027-07-16",
            1200.0,
            "Draft",
            "Packrafting alpine glacial lakes and testing acoustic echoes across Hljodaklettar honeycomb canyons.",
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO trips (user_id, title, destination, start_date, end_date, budget, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, trips_data)

    # Seed Waypoints for Trip 1 (Desert Solitude)
    waypoints_data = [
        (1, 3, "Trailhead & Tire Deflation Station", 33.2650, -116.3920, 1, 1, "Lower tires to 20 PSI before entering sandy washboard ruts.", now),
        (1, 3, "The Starlit Petroglyphs Canyon", 33.2560, -116.3752, 1, 2, "Main canyon camp. Pitch bivy behind the monolith to block northern gusts.", now),
        (1, None, "Font's Point Solitude Overlook", 33.3032, -116.2341, 2, 1, "Epic golden hour panorama over desolate badlands labyrinth.", now),
        (1, None, "Fish Creek Wash Camp", 33.0039, -116.1022, 3, 1, "Sheltered slot canyon camp with zero artificial ambient light.", now)
    ]

    cursor.executemany("""
    INSERT INTO trip_waypoints (trip_id, spot_id, title, latitude, longitude, day_number, order_index, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, waypoints_data)

    # Seed Sample Reservations / Bookings for Purvaj
    reservations_data = [
        (
            1,
            3,
            None,
            "WL-2026-8941",
            "Dark Sky Conservation Eco-Permit",
            "2026-11-15",
            2,
            30.0,
            "Confirmed",
            "Bringing red-light astronomy headlamps only to protect nocturnal owl habitats.",
            now
        ),
        (
            1,
            1,
            None,
            "WL-2026-3392",
            "Alpine Lake Low-Impact Packraft Permit",
            "2026-09-28",
            2,
            24.0,
            "Confirmed",
            "Renting dry-suits from local guardian Goran Jovanovski in Mavrovo village.",
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO reservations (
        user_id, spot_id, expedition_id, booking_reference, booking_type,
        travel_date, party_size, total_amount, status, special_requests, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, reservations_data)

    # Seed Sample Contact Submissions
    contact_data = [
        ("Sarah Jenkins", "sarah.j@gmail.com", "Permit availability for Mavrovo kayak expedition", "Hello, we are two respectful kayakers visiting in October. Do we need advance permits to land on the gravel spit near the sunken bell tower?", "Responded", now),
        ("Liam O'Connor", "liam.oc@wilderness.ie", "Volunteering as a Local Guardian for Kerry Dark Sky Reserve", "Would love to list our community-monitored dark sky sanctuary in southwest Ireland on WanderLore.", "New", now)
    ]

    cursor.executemany("""
    INSERT INTO contact_submissions (name, email, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    """, contact_data)

    # Seed Field Notes
    field_notes_data = [
        (1, "Elena V.", "Pathfinder", "Trail Alert", "Bridge over the west stream was washed out during May snowmelt. Use the shallow gravel ford 200m upstream. Water is knee-deep and frigid.", 28, "2026-08-14 11:20:00"),
        (1, "Goran J.", "Local Guardian", "Etiquette", "Please respect the old stone masonry. The mortar is made from lime and straw dating back to 1850; do not wedge tent stakes between stones.", 45, "2026-08-20 09:15:00"),
        (2, "Magnus K.", "Geologist", "Acoustics", "Stand inside the curved alcove near marker #4. Clapping your hands creates a double echo with a 0.8-second decay that sounds like a glass harmonica.", 37, "2026-07-29 16:45:00"),
        (3, "Sarah 'Stardog'", "Dark Sky Sentinel", "Camping Advice", "Pitch your shelter behind the red sandstone monolith to block northern 30mph desert gusts. Bring minimum 6 liters of water per person per day.", 52, "2026-08-02 21:10:00"),
        (3, "Purvaj", "Astro-Backpacker", "Trail Alert", "The dry washboard road has two sandy ruts at mile 9. Lower tire pressure to 22 PSI if you are in a 4x4. Total Bortle 1 bliss.", 63, "2026-09-01 22:15:00"),
        (4, "Kiran Rao", "Ethno-Botanist", "Local Lore", "The living roots are trained using hollowed areca palm trunks to guide young ficus shoots across the torrent. It takes 35 years before a child can safely cross.", 64, "2026-08-18 14:05:00"),
        (5, "Davide R.", "Historic Conservator", "Trail Alert", "The northern trail via the olive groves has loose scree. Wear stiff-soled vibram boots or you risk spraining an ankle with zero cellular signal.", 19, "2026-08-10 18:30:00"),
        (8, "Mateo Chan", "Local Guardian", "Leave No Trace", "We provide natural biodegradable soap at the trailhead rinse basin. Please wash off skin sweat before taking the rope ladder down.", 88, "2026-08-25 10:00:00"),
        (9, "Rashid Al-Nuaimi", "Local Guardian", "Acoustics", "The sands sing loudest precisely 45 minutes after sunset when thermal inversion cools the surface crust.", 41, "2026-08-28 19:30:00")
    ]

    cursor.executemany("""
    INSERT INTO field_notes (
        spot_id, author_name, author_badge, note_type, content, upvotes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, field_notes_data)

    # Seed Expeditions
    expeditions_data = [
        (
            "New Moon Solitude & Orionids Meteor Watch",
            "The Starlit Petroglyphs of Anza-Borrego",
            "California Desert",
            "Purvaj",
            "Astro-Backpacker",
            "2026-10-18",
            "Intermediate Backpacker",
            5,
            3,
            "Gathering 5 respectful stargazers for a zero-trace silent campout during the Orionids meteor shower. 4x4 carpool organized from Palm Desert.",
            now
        ),
        (
            "Monsoon Mist Living Bridges Trek",
            "The Living Root Bridges of Nohwet",
            "Meghalaya, India",
            "Daphne Lyngdoh",
            "Khasi Elder & Steward",
            "2026-11-04",
            "Moderate Hiker (1,200 steps)",
            6,
            4,
            "Guided respectful walk with Khasi elders explaining how aerial ficus root training preserves village connectivity without cutting a single forest tree.",
            now
        ),
        (
            "Low-Water Packraft Expedition to the Sunken Nave",
            "The Sunken Bell of Mavrovo",
            "Mavrovo Alpine Valley",
            "Goran Jovanovski",
            "Alpine Lake Guardian",
            "2026-09-28",
            "Packraft & Kayak Skills",
            4,
            2,
            "Rowing quietly across misty morning waters at sunrise to photograph the dry nave floor and clean plastic debris washed in from highland streams.",
            now
        ),
        (
            "Bioluminescent Silent Night Paddle",
            "The Bioluminescent Lagoon of Laguna Grande",
            "Puerto Rico",
            "Carmen Morales",
            "Marine Bioluminescence Warden",
            "2026-10-25",
            "Gentle Kayaker",
            6,
            5,
            "Silent paddle under the new moon with no artificial torches to observe electric turquoise water currents.",
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO expeditions (
        title, destination_name, region, organizer_name, organizer_badge, expedition_date,
        skill_level, max_participants, current_participants, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, expeditions_data)

    # Seed User Profiles
    profiles_data = [
        (
            "purvaj",
            "Purvaj",
            "Astro-Backpacker & High Solitude Seeker",
            "Dark Sky Sentinel",
            "Dedicated to charting places with zero light pollution and extreme acoustic tranquility. Believes the most sacred journeys happen when cell phones have zero bars.",
            "compass",
            "Stargazing Sanctuaries, Forgotten Ruins, Subterranean & Geo",
            90,
            18,
            1,
            now
        ),
        (
            "maya",
            "Maya Lin",
            "Botanical Custodian & Ethno-Botanist",
            "Sacred Grove Steward",
            "Researches living root architecture and indigenous plant conservation across monsoon valleys. Advocates for respectful cultural protocols.",
            "leaf",
            "Sacred Groves, Hidden Waterfalls, Forgotten Ruins",
            82,
            24,
            1,
            now
        ),
        (
            "kenji",
            "Kenji Sato",
            "Subterranean Geologist & Ghost Town Explorer",
            "Acoustic Geologist",
            "Fascinated by natural sound resonance, volcanic basalt acoustics, and abandoned stone settlements left behind by history.",
            "mountain",
            "Subterranean & Geo, Ghost Towns, Forgotten Ruins",
            85,
            20,
            1,
            now
        )
    ]

    cursor.executemany("""
    INSERT INTO user_profiles (
        username, display_name, title, badge, bio, avatar_icon,
        preferred_categories, min_solitude_pref, max_decibel_pref,
        leave_no_trace_pledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, profiles_data)

    # Seed Bookmarks
    bookmarks_data = [
        ("purvaj", 3, "Plan to bivy behind the western granite wall. Bring 200mm lens for Milky Way solstice alignment.", now),
        ("purvaj", 6, "Check highland pass status with Akureyri rangers before renting high-clearance 4x4.", now),
        ("purvaj", 9, "Pack binaural microphone to record sunset singing sand acoustic resonance.", now)
    ]

    cursor.executemany("""
    INSERT INTO user_bookmarks (username, spot_id, personal_note, created_at)
    VALUES (?, ?, ?, ?)
    """, bookmarks_data)

    # Seed Discussions
    discussions_data = [
        (
            "How do you calibrate Leave-No-Trace on fragile volcanic pumice?",
            "Astrid Lindholm",
            "Vatnajökull Wilderness Ranger",
            "Ethical Travel",
            "When traversing highland pumice fields like Askja, walking abreast rather than single-file prevents creating a permanent drainage trench in false crust. Would love to hear other rangers' protocols for Arctic tundra.",
            5,
            38,
            "2026-09-02 14:10:00"
        ),
        (
            "Best low-cost satellite messengers for zero-reception desert slot canyons?",
            "Purvaj",
            "Dark Sky Sentinel",
            "Gear & Safety",
            "Planning 3 days out in Anza-Borrego's dry washes where cell coverage is nonexistent. Anyone tested the Garmin InReach Mini vs ZOLEO on rugged granite canyons?",
            8,
            44,
            "2026-09-05 18:20:00"
        ),
        (
            "Protocol for visiting Living Root Bridges during village prayer days",
            "Daphne Lyngdoh",
            "Khasi Elder & Steward",
            "Local Etiquette",
            "Reminder to all wanderers traveling through East Khasi Hills: On Sundays, our sacred groves are closed for village prayer. Please time your arrival between Tuesday and Saturday morning.",
            3,
            62,
            "2026-09-07 10:45:00"
        )
    ]

    cursor.executemany("""
    INSERT INTO community_discussions (
        title, author_name, author_badge, category, content, replies_count, upvotes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, discussions_data)

if __name__ == "__main__":
    init_db(force_reseed=True)
    print("WanderLore production database successfully initialized with users, trips, waypoints, reservations, and contacts!")
