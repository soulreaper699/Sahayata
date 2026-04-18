import json
import os
import uuid
from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_socketio import SocketIO, emit
from flask_cors import CORS

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

DATA_FILE = 'data.json'

def load_data():
    d = {"donors": [], "ngos": [], "food_listings": [], "requests": [], "admins": []}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r') as f:
            try:
                loaded = json.load(f)
                d.update(loaded)
            except json.JSONDecodeError:
                pass

    # Ensure all keys exist
    for key in ["donors", "ngos", "food_listings", "requests", "admins"]:
        if key not in d: d[key] = []
    
    # Programmatically ensure the master admin exists (for production safety)
    if not any(a['name'] == 'admin@123' for a in d['admins']):
        d['admins'].append({
            "id": "admin-1",
            "name": "admin@123",
            "password": "fusionhacks"
        })
    return d

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=4)

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
    data = load_data()
    content = request.json
    role = content.get('role')
    
    # Simple unqiue check on names
    if role == 'donor':
        for u in data['donors']:
            if u['name'] == content.get('name'):
                return jsonify({"error": "User Name exists"}), 400
        new_user = {
            "id": str(uuid.uuid4()),
            "name": content.get('name'),
            "phone": content.get('phone'),
            "password": content.get('password')
        }
        data['donors'].append(new_user)
    elif role == 'ngo':
        for u in data['ngos']:
            if u['name'] == content.get('name'):
                return jsonify({"error": "NGO Name exists"}), 400
        new_user = {
            "id": str(uuid.uuid4()),
            "name": content.get('name'),
            "capacity": content.get('capacity'),
            "location": content.get('location'),
            "password": content.get('password')
        }
        data['ngos'].append(new_user)
    else:
        return jsonify({"error": "Invalid role"}), 400
        
    save_data(data)
    user_out = {k:v for k,v in new_user.items() if k != 'password'}
    user_out['role'] = role
    return jsonify(user_out), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = load_data()
    content = request.json
    name = content.get('name')
    password = content.get('password')
    
    for u in data['donors']:
        if u['name'] == name and u['password'] == password:
            user_out = {k:v for k,v in u.items() if k != 'password'}
            user_out['role'] = 'donor'
            return jsonify(user_out), 200
            
    for u in data['ngos']:
        if u['name'] == name and u['password'] == password:
            user_out = {k:v for k,v in u.items() if k != 'password'}
            user_out['role'] = 'ngo'
            return jsonify(user_out), 200

    for u in data.get('admins', []):
        if u['name'] == name and u['password'] == password:
            user_out = {k:v for k,v in u.items() if k != 'password'}
            user_out['role'] = 'admin'
            return jsonify(user_out), 200
            
    return jsonify({"error": "Invalid credentials"}), 401

# --- CORE LOGIC ---
def enrich_listing(listing, data_ref, current_user_id=None, current_role=None):
    enrich = dict(listing)
    
    # Always attach basic Donor name
    for d in data_ref['donors']:
        if d['id'] == listing['donor_id']:
            enrich['donor_name'] = d['name']

    # For Donor: Show pending NGO requests if available
    if listing['status'] == 'available' and current_role == 'donor' and current_user_id == listing['donor_id']:
        enrich['pending_requests'] = []
        for req in data_ref['requests']:
            if req['food_id'] == listing['id'] and req['status'] == 'pending':
                ngo_info = {"request_id": req['id'], "ngo_id": req['ngo_id']}
                for ngo in data_ref['ngos']:
                    if ngo['id'] == req['ngo_id']:
                        ngo_info.update({"name": ngo['name'], "capacity": ngo['capacity'], "location": ngo['location']})
                enrich['pending_requests'].append(ngo_info)

    # For NGO: Check if they already have a pending request on this available listing
    if listing['status'] == 'available' and current_role == 'ngo':
         # Did I already request it?
         for req in data_ref['requests']:
             if req['food_id'] == listing['id'] and req['ngo_id'] == current_user_id and req['status'] == 'pending':
                 enrich['ngo_has_pending'] = True
            
    # If Claimed or Completed, see if we reveal info based on Requests
    if enrich['status'] in ['claimed', 'completed']:
        for req in data_ref['requests']:
            if req['food_id'] == listing['id'] and req['status'] == 'accepted':
                # Attach NGO Name safely
                enrich['claimed_by_ngo_id'] = req['ngo_id']
                for ngo in data_ref['ngos']:
                    if ngo['id'] == req['ngo_id']:
                        enrich['ngo_name'] = ngo['name']
                        
                # Reveal info to parties involved:
                if (current_role == 'donor' and current_user_id == listing['donor_id']) or \
                   (current_role == 'ngo' and current_user_id == req['ngo_id']):
                       
                    for d in data_ref['donors']:
                        if d['id'] == listing['donor_id']:
                            enrich['donor_contact'] = {"phone": d['phone']}
                    for n in data_ref['ngos']:
                        if n['id'] == req['ngo_id']:
                            enrich['ngo_contact'] = {
                                "location": n['location'], 
                                "capacity": n['capacity']
                            }
    return enrich

@app.route('/api/listings', methods=['GET'])
def get_listings():
    user_id = request.args.get('user_id')
    role = request.args.get('role')
    
    data = load_data()
    listings = data['food_listings']
    
    filtered = []
    
    if role == 'donor' and user_id:
        filtered = [l for l in listings if l['donor_id'] == user_id]
        filtered = [enrich_listing(l, data, user_id, role) for l in filtered]
    elif role == 'ngo':
        for l in listings:
            if l['status'] == 'available':
                filtered.append(enrich_listing(l, data, user_id, role))
            elif l['status'] in ['claimed', 'completed']:
                # Find if this NGO requested it
                my_reqs = [r for r in data['requests'] if r['food_id'] == l['id'] and r['ngo_id'] == user_id and r['status'] == 'accepted']
                if my_reqs:
                    filtered.append(enrich_listing(l, data, user_id, role))
    
    return jsonify(filtered)

@app.route('/api/listings', methods=['POST'])
def add_listing():
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
    
    data = load_data()
    data['food_listings'].insert(0, new_listing)
    save_data(data)
    
    # Broadcast to all clients (with basic enrichment so NGO feed shows donor Name immediately)
    enriched = enrich_listing(new_listing, data)
    socketio.emit('new_listing', enriched)
    return jsonify(enriched), 201

@app.route('/api/listings/<listing_id>/request', methods=['POST'])
def request_listing(listing_id):
    content = request.json
    ngo_id = content.get("ngo_id")
    
    data = load_data()
    
    # 1. Update listing status to claimed
    target_listing = None
    for l in data['food_listings']:
        if l['id'] == listing_id and l['status'] == 'available':
            target_listing = l
            break
            
    if not target_listing:
         return jsonify({"error": "Listing not available"}), 400
         
    # 2. Generate a Request object
    auto_accept = target_listing.get('auto_accept', False)
    req_status = 'accepted' if auto_accept else 'pending'
    
    if auto_accept:
        target_listing['status'] = 'claimed'

    new_request = {
        "id": str(uuid.uuid4()),
        "ngo_id": ngo_id,
        "food_id": listing_id,
        "status": req_status
    }
    data['requests'].append(new_request)
    save_data(data)
    
    socketio.emit('listing_updated')
    return jsonify({"success": True, "status": req_status}), 200

@app.route('/api/listings/<listing_id>/approve', methods=['POST'])
def approve_request(listing_id):
    content = request.json
    request_id = content.get("request_id")
    
    data = load_data()
    
    # Update Listing
    for l in data['food_listings']:
        if l['id'] == listing_id:
            l['status'] = 'claimed'
            break
            
    # Mutate all requests tied to this listing
    for req in data['requests']:
        if req['food_id'] == listing_id:
            if req['id'] == request_id:
                req['status'] = 'accepted'
            elif req['status'] == 'pending':
                req['status'] = 'rejected'
                
    save_data(data)
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/listings/<listing_id>/complete', methods=['POST'])
def complete_listing(listing_id):
    data = load_data()
    for l in data['food_listings']:
        if l['id'] == listing_id and l['status'] == 'claimed':
            l['status'] = "completed"
            save_data(data)
            socketio.emit('listing_updated')
            return jsonify({"success": True}), 200

    return jsonify({"error": "Failed to complete"}), 400

@app.route('/api/stats', methods=['GET'])
def get_stats():
    data = load_data()
    completed_meals = 0
    completed_count = len([l for l in data['food_listings'] if l['status'] == 'completed'])
    ngo_count = len(data['ngos'])
    
    return jsonify({
        "meals_saved": completed_count,
        "active_ngos": ngo_count
    })

# --- ADMIN ENDPOINTS ---
@app.route('/api/admin/overview', methods=['GET'])
def admin_overview():
    # In a real app, we'd check session/token here
    data = load_data()
    return jsonify(data)

@app.route('/api/admin/delete-listing/<listing_id>', methods=['DELETE'])
def admin_delete_listing(listing_id):
    data = load_data()
    data['food_listings'] = [l for l in data['food_listings'] if l['id'] != listing_id]
    # Also delete associated requests
    data['requests'] = [r for r in data['requests'] if r['food_id'] != listing_id]
    save_data(data)
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/admin/delete-user/<role>/<user_id>', methods=['DELETE'])
def admin_delete_user(role, user_id):
    data = load_data()
    if role == 'donor':
        data['donors'] = [u for u in data['donors'] if u['id'] != user_id]
        # Clean up listings by this donor
        data['food_listings'] = [l for l in data['food_listings'] if l['donor_id'] != user_id]
    elif role == 'ngo':
        data['ngos'] = [u for u in data['ngos'] if u['id'] != user_id]
        # Clean up requests by this NGO
        data['requests'] = [r for r in data['requests'] if r['ngo_id'] != user_id]
        
    save_data(data)
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
