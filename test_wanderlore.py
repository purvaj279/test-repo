import os
import importlib
import unittest
import json
from app import app
import database
from database import init_db

class WanderLoreTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        init_db(force_reseed=True)

    def test_01_index_page(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'WANDERLORE', response.data)

    def test_02_get_spots_with_personalization(self):
        response = self.client.get('/api/spots?username=purvaj')
        self.assertEqual(response.status_code, 200)
        spots = json.loads(response.data)
        self.assertGreaterEqual(len(spots), 12)
        # Verify personalized match percentage is calculated
        self.assertTrue('match_percentage' in spots[0])
        self.assertTrue('match_reason' in spots[0])
        self.assertGreaterEqual(spots[0]['match_percentage'], 65)

    def test_03_recommended_matches(self):
        response = self.client.get('/api/spots?username=purvaj&category=Recommended')
        self.assertEqual(response.status_code, 200)
        spots = json.loads(response.data)
        for s in spots:
            self.assertGreaterEqual(s['match_percentage'], 85)

    def test_04_user_profile_and_personas(self):
        # Fetch personas
        personas_res = self.client.get('/api/personas')
        self.assertEqual(personas_res.status_code, 200)
        personas = json.loads(personas_res.data)
        self.assertGreaterEqual(len(personas), 3)
        self.assertEqual(personas[0]['username'], 'purvaj')

        # Get profile
        prof_res = self.client.get('/api/profile?username=purvaj')
        self.assertEqual(prof_res.status_code, 200)
        prof = json.loads(prof_res.data)
        self.assertEqual(prof['display_name'], 'Purvaj')

        # Update profile
        update_res = self.client.post('/api/profile', json={
            'username': 'purvaj',
            'display_name': 'Purvaj The Explorer',
            'title': 'High Altitude & Dark Sky Master',
            'bio': 'Looking for silence.',
            'preferred_categories': 'Stargazing Sanctuaries',
            'min_solitude_pref': 92,
            'max_decibel_pref': 18
        })
        self.assertEqual(update_res.status_code, 200)
        updated_data = json.loads(update_res.data)
        self.assertEqual(updated_data['profile']['display_name'], 'Purvaj The Explorer')

    def test_05_bookmarks_and_personal_notes(self):
        # Toggle bookmark
        toggle_res = self.client.post('/api/bookmarks/toggle', json={
            'username': 'purvaj',
            'spot_id': 1,
            'personal_note': 'Plan to bring packraft at sunrise.'
        })
        self.assertEqual(toggle_res.status_code, 200)
        self.assertTrue(json.loads(toggle_res.data)['success'])

        # Get bookmarks
        b_res = self.client.get('/api/bookmarks?username=purvaj')
        self.assertEqual(b_res.status_code, 200)
        bookmarks = json.loads(b_res.data)
        self.assertTrue(any(b['id'] == 1 for b in bookmarks))

        # Update note
        note_res = self.client.post('/api/bookmarks/1/note', json={
            'username': 'purvaj',
            'personal_note': 'Updated packraft itinerary.'
        })
        self.assertEqual(note_res.status_code, 200)

    def test_06_riddle_unlock_flow(self):
        # 1: Wrong answer
        wrong_res = self.client.post('/api/spots/1/unlock', json={'answer': 'incorrect_guess'})
        self.assertEqual(wrong_res.status_code, 400)
        wrong_data = json.loads(wrong_res.data)
        self.assertFalse(wrong_data['success'])
        self.assertTrue('hint' in wrong_data)

        # 2: Correct answer for Spot 1 ("salamander")
        correct_res = self.client.post('/api/spots/1/unlock', json={'answer': 'salamander'})
        self.assertEqual(correct_res.status_code, 200)
        correct_data = json.loads(correct_res.data)
        self.assertTrue(correct_data['success'])
        self.assertAlmostEqual(correct_data['latitude'], 41.7103, places=2)

    def test_07_community_discussions(self):
        # Get discussions
        d_res = self.client.get('/api/discussions')
        self.assertEqual(d_res.status_code, 200)
        threads = json.loads(d_res.data)
        self.assertGreaterEqual(len(threads), 3)

        # Create discussion
        post_res = self.client.post('/api/discussions', json={
            'title': 'Tips for silent bivouac camping?',
            'author_name': 'Purvaj',
            'author_badge': 'Astro-Backpacker',
            'category': 'Gear & Zero-Trace Systems',
            'content': 'How to reduce footprint when setting up tarps on rocky terrain?'
        })
        self.assertEqual(post_res.status_code, 200)
        disc_id = json.loads(post_res.data)['id']

        # Upvote discussion
        up_res = self.client.post(f'/api/discussions/{disc_id}/upvote')
        self.assertEqual(up_res.status_code, 200)

    def test_08_platform_stats(self):
        stats_res = self.client.get('/api/stats')
        self.assertEqual(stats_res.status_code, 200)
        stats = json.loads(stats_res.data)
        self.assertGreaterEqual(stats['total_sanctuaries'], 12)
        self.assertGreaterEqual(stats['saved_journeys'], 1)

    def test_09_vercel_sqlite_path_uses_temp_dir(self):
        original_vercel = os.environ.get('VERCEL')
        original_db_path = getattr(database, 'DB_PATH', None)
        try:
            os.environ['VERCEL'] = '1'
            importlib.reload(database)
            self.assertIn('tmp', database.DB_PATH.lower())
            self.assertTrue(os.path.exists(os.path.dirname(database.DB_PATH)))
        finally:
            if original_vercel is None:
                os.environ.pop('VERCEL', None)
            else:
                os.environ['VERCEL'] = original_vercel
            if original_db_path is not None:
                database.DB_PATH = original_db_path
            importlib.reload(database)

if __name__ == '__main__':
    unittest.main()
