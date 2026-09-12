import os
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from database import get_db_connection, init_db

app = Flask(__name__)

# Ensure DB tables exist
init_db()

@app.route("/")
def index():
    return render_template("index.html")

# ============================================================
# 1. SANCTUARIES API
# ============================================================
@app.route("/api/spots", methods=["GET"])
def get_spots():
    query = request.args.get("q", "").strip().lower()
    category = request.args.get("category", "").strip()
    min_solitude = request.args.get("min_solitude", type=int, default=0)
    difficulty = request.args.get("difficulty", "").strip()
    username = request.args.get("username", "purvaj").strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor()

    # Get user profile for personalized match computation
    cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
    user_row = cursor.fetchone()
    user = dict(user_row) if user_row else {
        "preferred_categories": "Stargazing Sanctuaries, Forgotten Ruins",
        "min_solitude_pref": 85,
        "max_decibel_pref": 20
    }

    # Get user's bookmarks
    cursor.execute("SELECT spot_id FROM user_bookmarks WHERE username = ?", (username,))
    bookmarked_ids = {r["spot_id"] for r in cursor.fetchall()}

    sql = "SELECT * FROM spots WHERE solitude_score >= ?"
    params = [min_solitude]

    if category and category != "All" and category != "Recommended":
        sql += " AND category = ?"
        params.append(category)

    if difficulty and difficulty != "All":
        sql += " AND difficulty LIKE ?"
        params.append(f"%{difficulty}%")

    if query:
        sql += " AND (LOWER(name) LIKE ? OR LOWER(region) LIKE ? OR LOWER(country) LIKE ? OR LOWER(lore) LIKE ?)"
        term = f"%{query}%"
        params.extend([term, term, term, term])

    sql += " ORDER BY solitude_score DESC, upvotes DESC"
    cursor.execute(sql, params)
    rows = cursor.fetchall()

    user_preferred_cats = [c.strip().lower() for c in user.get("preferred_categories", "").split(",")]
    user_min_sol = user.get("min_solitude_pref", 80)
    user_max_db = user.get("max_decibel_pref", 25)

    spots = []
    for r in rows:
        spot = dict(r)
        
        # Calculate Personal Match Percentage
        score = 60
        reasons = []

        # Category match (+25)
        if any(cat in spot["category"].lower() for cat in user_preferred_cats):
            score += 25
            reasons.append(f"Matches your favorite {spot['category']} terrain")

        # Solitude match (+10)
        if spot["solitude_score"] >= user_min_sol:
            score += 10
            reasons.append(f"High solitude ({spot['solitude_score']}%) meets your threshold")

        # Decibel calm match (+5)
        if spot["decibel_level"] <= user_max_db:
            score += 5
            reasons.append(f"Acoustic calm ({spot['decibel_level']} dB) matches your quiet preference")

        match_pct = min(99, max(68, score))
        spot["match_percentage"] = match_pct
        spot["match_reason"] = " • ".join(reasons) if reasons else "Untouched peaceful sanctuary"
        spot["is_bookmarked"] = spot["id"] in bookmarked_ids

        # If spot is protected, provide approximate display coordinates for map pin
        if spot["is_protected"]:
            spot["display_lat"] = round(spot["latitude"], 1)
            spot["display_lng"] = round(spot["longitude"], 1)
            spot["exact_unlocked"] = False
        else:
            spot["display_lat"] = spot["latitude"]
            spot["display_lng"] = spot["longitude"]
            spot["exact_unlocked"] = True
        spots.append(spot)

    conn.close()

    # If 'Recommended' filter is requested, sort primarily by personal match percentage
    if category == "Recommended":
        spots = [s for s in spots if s["match_percentage"] >= 85]
        spots.sort(key=lambda s: s["match_percentage"], reverse=True)

    return jsonify(spots)

@app.route("/api/spots/<int:spot_id>", methods=["GET"])
def get_spot_detail(spot_id):
    username = request.args.get("username", "purvaj").strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM spots WHERE id = ?", (spot_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Spot not found"}), 404

    spot = dict(row)

    # Get Field Notes
    cursor.execute(
        "SELECT * FROM field_notes WHERE spot_id = ? ORDER BY upvotes DESC, created_at DESC",
        (spot_id,)
    )
    notes = [dict(n) for n in cursor.fetchall()]
    spot["notes"] = notes

    # Check bookmark status and personal note
    cursor.execute(
        "SELECT personal_note FROM user_bookmarks WHERE username = ? AND spot_id = ?",
        (username, spot_id)
    )
    bookmark_row = cursor.fetchone()
    spot["is_bookmarked"] = bookmark_row is not None
    spot["personal_note"] = bookmark_row["personal_note"] if bookmark_row else ""

    conn.close()
    return jsonify(spot)

@app.route("/api/spots/<int:spot_id>/unlock", methods=["POST"])
def unlock_spot_coordinates(spot_id):
    data = request.get_json() or {}
    user_answer = data.get("answer", "").strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, name, latitude, longitude, riddle_answer, riddle_hint FROM spots WHERE id = ?", (spot_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Spot not found"}), 404

    target_answer = row["riddle_answer"].strip().lower()
    
    # Check if answer matches directly or contains the keyword
    if user_answer and (user_answer in target_answer or target_answer in user_answer):
        conn.close()
        return jsonify({
            "success": True,
            "message": "Ancient riddle solved! Exact coordinates unlocked.",
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "spot_id": spot_id
        })
    else:
        conn.close()
        return jsonify({
            "success": False,
            "message": "The guardian whispers that your answer does not align with the lore.",
            "hint": row["riddle_hint"]
        }), 400

@app.route("/api/spots/<int:spot_id>/upvote", methods=["POST"])
def upvote_spot(spot_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE spots SET upvotes = upvotes + 1 WHERE id = ?", (spot_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM spots WHERE id = ?", (spot_id,))
    new_votes = cursor.fetchone()["upvotes"]
    conn.close()
    return jsonify({"success": True, "upvotes": new_votes})

@app.route("/api/spots/<int:spot_id>/notes", methods=["POST"])
def add_field_note(spot_id):
    data = request.get_json() or {}
    author_name = data.get("author_name", "Trail Wanderer").strip()
    author_badge = data.get("author_badge", "Explorer").strip()
    note_type = data.get("note_type", "Trail Alert").strip()
    content = data.get("content", "").strip()

    if not content:
        return jsonify({"error": "Note content cannot be empty"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO field_notes (spot_id, author_name, author_badge, note_type, content, upvotes, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    """, (spot_id, author_name, author_badge, note_type, content, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({
        "success": True,
        "note": {
            "id": new_id,
            "spot_id": spot_id,
            "author_name": author_name,
            "author_badge": author_badge,
            "note_type": note_type,
            "content": content,
            "upvotes": 0,
            "created_at": now
        }
    })

@app.route("/api/notes/<int:note_id>/upvote", methods=["POST"])
def upvote_note(note_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE field_notes SET upvotes = upvotes + 1 WHERE id = ?", (note_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM field_notes WHERE id = ?", (note_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return jsonify({"success": True, "upvotes": row["upvotes"]})
    return jsonify({"error": "Note not found"}), 404

@app.route("/api/spots", methods=["POST"])
def create_spot():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    tagline = data.get("tagline", "").strip()
    region = data.get("region", "").strip()
    country = data.get("country", "").strip()
    category = data.get("category", "Forgotten Ruins").strip()
    latitude = float(data.get("latitude", 0.0))
    longitude = float(data.get("longitude", 0.0))
    image_url = data.get("image_url", "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80").strip()
    lore = data.get("lore", "").strip()
    solitude_score = int(data.get("solitude_score", 85))
    decibel_level = int(data.get("decibel_level", 20))
    crowd_factor = data.get("crowd_factor", "Under 5 visitors per month").strip()
    cell_signal = data.get("cell_signal", "0 Bars - Pure Wilderness").strip()
    difficulty = data.get("difficulty", "Moderate Trail").strip()
    best_season = data.get("best_season", "Year-round").strip()
    leave_no_trace_notes = data.get("leave_no_trace_notes", "Leave no trace. Pack out all waste.").strip()
    guardian_name = data.get("guardian_name", "Local Community").strip()
    guardian_title = data.get("guardian_title", "Sanctuary Guardian").strip()
    is_protected = 1 if data.get("is_protected") else 0
    riddle_question = data.get("riddle_question", "").strip()
    riddle_answer = data.get("riddle_answer", "").strip()
    riddle_hint = data.get("riddle_hint", "").strip()
    soundscape_type = data.get("soundscape_type", "forest_wind").strip()

    if not name or not region or not lore:
        return jsonify({"error": "Name, region, and lore are required"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO spots (
        name, tagline, region, country, category, latitude, longitude, image_url, lore,
        solitude_score, decibel_level, crowd_factor, cell_signal, difficulty, best_season,
        leave_no_trace_notes, guardian_name, guardian_title, riddle_question, riddle_answer,
        riddle_hint, is_protected, soundscape_type, upvotes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    """, (
        name, tagline, region, country, category, latitude, longitude, image_url, lore,
        solitude_score, decibel_level, crowd_factor, cell_signal, difficulty, best_season,
        leave_no_trace_notes, guardian_name, guardian_title, riddle_question, riddle_answer,
        riddle_hint, is_protected, soundscape_type, now
    ))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({"success": True, "id": new_id})

# ============================================================
# 2. PERSONALIZATION & PROFILES API
# ============================================================
@app.route("/api/personas", methods=["GET"])
def get_personas():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_profiles ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/profile", methods=["GET", "POST"])
def user_profile():
    conn = get_db_connection()
    cursor = conn.cursor()

    if request.method == "GET":
        username = request.args.get("username", "purvaj").strip().lower()
        cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "Profile not found"}), 404
        return jsonify(dict(row))

    elif request.method == "POST":
        data = request.get_json() or {}
        username = data.get("username", "purvaj").strip().lower()
        display_name = data.get("display_name", "Purvaj").strip()
        title = data.get("title", "Astro-Backpacker").strip()
        bio = data.get("bio", "").strip()
        preferred_categories = data.get("preferred_categories", "Stargazing Sanctuaries, Forgotten Ruins").strip()
        min_solitude = int(data.get("min_solitude_pref", 85))
        max_decibel = int(data.get("max_decibel_pref", 20))

        cursor.execute("""
        UPDATE user_profiles
        SET display_name = ?, title = ?, bio = ?, preferred_categories = ?,
            min_solitude_pref = ?, max_decibel_pref = ?
        WHERE username = ?
        """, (display_name, title, bio, preferred_categories, min_solitude, max_decibel, username))
        conn.commit()

        cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
        updated = dict(cursor.fetchone())
        conn.close()
        return jsonify({"success": True, "profile": updated})

# ============================================================
# 3. MY JOURNEY / BOOKMARKS API
# ============================================================
@app.route("/api/bookmarks", methods=["GET"])
def get_bookmarks():
    username = request.args.get("username", "purvaj").strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
    SELECT s.*, b.personal_note, b.created_at AS bookmarked_at
    FROM spots s
    JOIN user_bookmarks b ON s.id = b.spot_id
    WHERE b.username = ?
    ORDER BY b.created_at DESC
    """, (username,))
    rows = cursor.fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])

@app.route("/api/bookmarks/toggle", methods=["POST"])
def toggle_bookmark():
    data = request.get_json() or {}
    username = data.get("username", "purvaj").strip().lower()
    spot_id = int(data.get("spot_id", 0))
    personal_note = data.get("personal_note", "").strip()

    if not spot_id:
        return jsonify({"error": "spot_id is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM user_bookmarks WHERE username = ? AND spot_id = ?", (username, spot_id))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("DELETE FROM user_bookmarks WHERE username = ? AND spot_id = ?", (username, spot_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "is_bookmarked": False, "message": "Sanctuary removed from your journey."})
    else:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
        INSERT INTO user_bookmarks (username, spot_id, personal_note, created_at)
        VALUES (?, ?, ?, ?)
        """, (username, spot_id, personal_note, now))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "is_bookmarked": True, "message": "Sanctuary saved to your journey ledger!"})

@app.route("/api/bookmarks/<int:spot_id>/note", methods=["POST"])
def update_bookmark_note(spot_id):
    data = request.get_json() or {}
    username = data.get("username", "purvaj").strip().lower()
    personal_note = data.get("personal_note", "").strip()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE user_bookmarks SET personal_note = ? WHERE username = ? AND spot_id = ?
    """, (personal_note, username, spot_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "personal_note": personal_note})

# ============================================================
# 4. EXPEDITIONS & DISCUSSIONS
# ============================================================
@app.route("/api/expeditions", methods=["GET"])
def get_expeditions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM expeditions ORDER BY created_at DESC")
    expeditions = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(expeditions)

@app.route("/api/expeditions", methods=["POST"])
def create_expedition():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    destination_name = data.get("destination_name", "").strip()
    region = data.get("region", "").strip()
    organizer_name = data.get("organizer_name", "Trail Wanderer").strip()
    organizer_badge = data.get("organizer_badge", "Pathfinder").strip()
    expedition_date = data.get("expedition_date", "").strip()
    skill_level = data.get("skill_level", "Moderate Hiker").strip()
    max_participants = int(data.get("max_participants", 5))
    description = data.get("description", "").strip()

    if not title or not destination_name or not expedition_date:
        return jsonify({"error": "Missing required fields"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO expeditions (
        title, destination_name, region, organizer_name, organizer_badge,
        expedition_date, skill_level, max_participants, current_participants,
        description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    """, (title, destination_name, region, organizer_name, organizer_badge,
          expedition_date, skill_level, max_participants, description, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({"success": True, "id": new_id})

@app.route("/api/expeditions/<int:exp_id>/join", methods=["POST"])
def join_expedition(exp_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT current_participants, max_participants FROM expeditions WHERE id = ?", (exp_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Expedition not found"}), 404

    if row["current_participants"] >= row["max_participants"]:
        conn.close()
        return jsonify({"error": "Expedition roster is full to prevent environmental impact"}), 400

    cursor.execute("UPDATE expeditions SET current_participants = current_participants + 1 WHERE id = ?", (exp_id,))
    conn.commit()
    new_count = row["current_participants"] + 1
    conn.close()

    return jsonify({"success": True, "current_participants": new_count})

@app.route("/api/discussions", methods=["GET", "POST"])
def discussions():
    conn = get_db_connection()
    cursor = conn.cursor()

    if request.method == "GET":
        cursor.execute("SELECT * FROM community_discussions ORDER BY created_at DESC")
        threads = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return jsonify(threads)

    elif request.method == "POST":
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        author_name = data.get("author_name", "Explorer").strip()
        author_badge = data.get("author_badge", "Pathfinder").strip()
        category = data.get("category", "General Discussion").strip()
        content = data.get("content", "").strip()

        if not title or not content:
            conn.close()
            return jsonify({"error": "Title and content required"}), 400

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
        INSERT INTO community_discussions (title, author_name, author_badge, category, content, replies_count, upvotes, created_at)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?)
        """, (title, author_name, author_badge, category, content, now))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()

        return jsonify({"success": True, "id": new_id})

@app.route("/api/discussions/<int:disc_id>/upvote", methods=["POST"])
def upvote_discussion(disc_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE community_discussions SET upvotes = upvotes + 1 WHERE id = ?", (disc_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM community_discussions WHERE id = ?", (disc_id,))
    new_votes = cursor.fetchone()["upvotes"]
    conn.close()
    return jsonify({"success": True, "upvotes": new_votes})

@app.route("/api/stats", methods=["GET"])
def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*), AVG(solitude_score), AVG(decibel_level) FROM spots")
    spot_count, avg_solitude, avg_decibel = cursor.fetchone()

    cursor.execute("SELECT COUNT(*) FROM field_notes")
    note_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM expeditions")
    expedition_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM user_bookmarks")
    bookmark_count = cursor.fetchone()[0]

    conn.close()

    return jsonify({
        "total_sanctuaries": spot_count,
        "avg_solitude_score": round(avg_solitude or 90, 1),
        "avg_decibel_level": round(avg_decibel or 18, 1),
        "community_field_notes": note_count,
        "active_expeditions": expedition_count,
        "saved_journeys": bookmark_count
    })

if __name__ == "__main__":
    print("Starting WanderLore server on http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
