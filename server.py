import os
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from pymongo import MongoClient

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- DATABASE CONNECTION ---
MONGO_URI = os.environ.get('MONGO_URI', '')
_db = None

def get_db():
    global _db
    if _db is None:
        client = MongoClient(MONGO_URI)
        _db = client['sahayata']
        # Ensure the master admin exists in the database (idempotent upsert)
        _db.admins.update_one(
            {"name": "admin@123"},
            {"$setOnInsert": {"id": "admin-1", "name": "admin@123", "password": "fusionhacks"}},
            upsert=True
        )
    return _db

def load_data():
    db = get_db()
    return {
        'donors':        list(db.donors.find({}, {'_id': 0})),
        'ngos':          list(db.ngos.find({}, {'_id': 0})),
        'food_listings': list(db.food_listings.find({}, {'_id': 0})),
        'requests':      list(db.requests.find({}, {'_id': 0})),
        'admins':        list(db.admins.find({}, {'_id': 0})),
    }

def save_data(data):
    """Sync in-memory data back to MongoDB using upsert by 'id' field."""
    db = get_db()
    for collection_name in ['donors', 'ngos', 'food_listings', 'requests']:
        for item in data.get(collection_name, []):
            db[collection_name].update_one(
                {'id': item['id']},
                {'$set': item},
                upsert=True
            )

def delete_from_db(collection_name, field, value):
    """Helper to delete documents from a collection."""
    db = get_db()
    db[collection_name].delete_many({field: value})

# --- STATIC ROUTING ---
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return "Not Found", 404

# --- AUTHENTICATION ---
@app.route('/api/register', methods=['POST'])
def register():
    db = get_db()
    content = request.json
    role = content.get('role')

    if role == 'donor':
        if db.donors.find_one({'name': content.get('name')}, {'_id': 0}):
            return jsonify({"error": "User Name exists"}), 400
        new_user = {
            "id": str(uuid.uuid4()),
            "name": content.get('name'),
            "phone": content.get('phone'),
            "password": content.get('password')
        }
        db.donors.insert_one({**new_user})
    elif role == 'ngo':
        if db.ngos.find_one({'name': content.get('name')}, {'_id': 0}):
            return jsonify({"error": "NGO Name exists"}), 400
        new_user = {
            "id": str(uuid.uuid4()),
            "name": content.get('name'),
            "capacity": content.get('capacity'),
            "location": content.get('location'),
            "password": content.get('password')
        }
        db.ngos.insert_one({**new_user})
    else:
        return jsonify({"error": "Invalid role"}), 400

    user_out = {k: v for k, v in new_user.items() if k != 'password'}
    user_out['role'] = role
    return jsonify(user_out), 201

@app.route('/api/login', methods=['POST'])
def login():
    db = get_db()
    content = request.json
    name = content.get('name')
    password = content.get('password')

    u = db.donors.find_one({'name': name, 'password': password}, {'_id': 0})
    if u:
        user_out = {k: v for k, v in u.items() if k != 'password'}
        user_out['role'] = 'donor'
        return jsonify(user_out), 200

    u = db.ngos.find_one({'name': name, 'password': password}, {'_id': 0})
    if u:
        user_out = {k: v for k, v in u.items() if k != 'password'}
        user_out['role'] = 'ngo'
        return jsonify(user_out), 200

    u = db.admins.find_one({'name': name, 'password': password}, {'_id': 0})
    if u:
        user_out = {k: v for k, v in u.items() if k != 'password'}
        user_out['role'] = 'admin'
        return jsonify(user_out), 200

    return jsonify({"error": "Invalid credentials"}), 401

# --- CORE LOGIC ---
def enrich_listing(listing, data_ref, current_user_id=None, current_role=None):
    enrich = dict(listing)

    for d in data_ref['donors']:
        if d['id'] == listing['donor_id']:
            enrich['donor_name'] = d['name']

    if listing['status'] == 'available' and current_role == 'donor' and current_user_id == listing['donor_id']:
        enrich['pending_requests'] = []
        for req in data_ref['requests']:
            if req['food_id'] == listing['id'] and req['status'] == 'pending':
                ngo_info = {"request_id": req['id'], "ngo_id": req['ngo_id']}
                for ngo in data_ref['ngos']:
                    if ngo['id'] == req['ngo_id']:
                        ngo_info.update({"name": ngo['name'], "capacity": ngo['capacity'], "location": ngo['location']})
                enrich['pending_requests'].append(ngo_info)

    if listing['status'] == 'available' and current_role == 'ngo':
        for req in data_ref['requests']:
            if req['food_id'] == listing['id'] and req['ngo_id'] == current_user_id and req['status'] == 'pending':
                enrich['ngo_has_pending'] = True

    if enrich['status'] in ['claimed', 'completed']:
        for req in data_ref['requests']:
            if req['food_id'] == listing['id'] and req['status'] == 'accepted':
                enrich['claimed_by_ngo_id'] = req['ngo_id']
                for ngo in data_ref['ngos']:
                    if ngo['id'] == req['ngo_id']:
                        enrich['ngo_name'] = ngo['name']

                if (current_role == 'donor' and current_user_id == listing['donor_id']) or \
                   (current_role == 'ngo' and current_user_id == req['ngo_id']):
                    for d in data_ref['donors']:
                        if d['id'] == listing['donor_id']:
                            enrich['donor_contact'] = {"phone": d['phone']}
                    for n in data_ref['ngos']:
                        if n['id'] == req['ngo_id']:
                            enrich['ngo_contact'] = {"location": n['location'], "capacity": n['capacity']}
    return enrich

@app.route('/api/listings', methods=['GET'])
def get_listings():
    user_id = request.args.get('user_id')
    role = request.args.get('role')
    data = load_data()
    listings = data['food_listings']
    filtered = []

    if role == 'donor' and user_id:
        filtered = [enrich_listing(l, data, user_id, role) for l in listings if l['donor_id'] == user_id]
    elif role == 'ngo':
        for l in listings:
            if l['status'] == 'available':
                filtered.append(enrich_listing(l, data, user_id, role))
            elif l['status'] in ['claimed', 'completed']:
                my_reqs = [r for r in data['requests'] if r['food_id'] == l['id'] and r['ngo_id'] == user_id and r['status'] == 'accepted']
                if my_reqs:
                    filtered.append(enrich_listing(l, data, user_id, role))

    return jsonify(filtered)

@app.route('/api/listings', methods=['POST'])
def add_listing():
    db = get_db()
    content = request.json
    new_listing = {
        "id": str(uuid.uuid4()),
        "donor_id": content.get("donor_id"),
        "food_type": content.get("food_type"),
        "quantity": content.get("quantity"),
        "expiry_time": content.get("expiry_time"),
        "location": content.get("location"),
        "auto_accept": content.get("auto_accept", False),
        "status": "available"
    }
    db.food_listings.insert_one({**new_listing})
    data = load_data()
    enriched = enrich_listing(new_listing, data)
    socketio.emit('new_listing', enriched)
    return jsonify(enriched), 201

@app.route('/api/listings/<listing_id>/request', methods=['POST'])
def request_listing(listing_id):
    db = get_db()
    content = request.json
    ngo_id = content.get("ngo_id")

    target_listing = db.food_listings.find_one({'id': listing_id, 'status': 'available'}, {'_id': 0})
    if not target_listing:
        return jsonify({"error": "Listing not available"}), 400

    auto_accept = target_listing.get('auto_accept', False)
    req_status = 'accepted' if auto_accept else 'pending'

    if auto_accept:
        db.food_listings.update_one({'id': listing_id}, {'$set': {'status': 'claimed'}})

    new_request = {
        "id": str(uuid.uuid4()),
        "ngo_id": ngo_id,
        "food_id": listing_id,
        "status": req_status
    }
    db.requests.insert_one({**new_request})
    socketio.emit('listing_updated')
    return jsonify({"success": True, "status": req_status}), 200

@app.route('/api/listings/<listing_id>/approve', methods=['POST'])
def approve_request(listing_id):
    db = get_db()
    content = request.json
    request_id = content.get("request_id")

    db.food_listings.update_one({'id': listing_id}, {'$set': {'status': 'claimed'}})
    db.requests.update_one({'id': request_id}, {'$set': {'status': 'accepted'}})
    db.requests.update_many({'food_id': listing_id, 'status': 'pending', 'id': {'$ne': request_id}}, {'$set': {'status': 'rejected'}})

    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/listings/<listing_id>/complete', methods=['POST'])
def complete_listing(listing_id):
    db = get_db()
    result = db.food_listings.update_one({'id': listing_id, 'status': 'claimed'}, {'$set': {'status': 'completed'}})
    if result.modified_count:
        socketio.emit('listing_updated')
        return jsonify({"success": True}), 200
    return jsonify({"error": "Failed to complete"}), 400

@app.route('/api/stats', methods=['GET'])
def get_stats():
    db = get_db()
    completed_count = db.food_listings.count_documents({'status': 'completed'})
    ngo_count = db.ngos.count_documents({})
    return jsonify({"meals_saved": completed_count, "active_ngos": ngo_count})

# --- ADMIN ENDPOINTS ---
@app.route('/api/admin/overview', methods=['GET'])
def admin_overview():
    data = load_data()
    return jsonify(data)

@app.route('/api/admin/delete-listing/<listing_id>', methods=['DELETE'])
def admin_delete_listing(listing_id):
    db = get_db()
    db.food_listings.delete_one({'id': listing_id})
    db.requests.delete_many({'food_id': listing_id})
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/admin/delete-user/<role>/<user_id>', methods=['DELETE'])
def admin_delete_user(role, user_id):
    db = get_db()
    if role == 'donor':
        db.donors.delete_one({'id': user_id})
        listing_ids = [l['id'] for l in db.food_listings.find({'donor_id': user_id}, {'_id': 0, 'id': 1})]
        db.food_listings.delete_many({'donor_id': user_id})
        if listing_ids:
            db.requests.delete_many({'food_id': {'$in': listing_ids}})
    elif role == 'ngo':
        db.ngos.delete_one({'id': user_id})
        db.requests.delete_many({'ngo_id': user_id})

    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
