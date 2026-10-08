import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class ContinuationPolicyTests(unittest.TestCase):
    def test_explicit_development_needs_no_routine_selection(self):
        handoff = (ROOT / '.ai/NEXT-ACTION-OPTIONS.md').read_text(encoding='utf-8')
        self.assertIn('Mode A', handoff)
        self.assertIn('Do **not** ask', handoff)
        self.assertIn('continue another independent permitted lane', handoff)

    def test_multi_milestone_continuation_is_explicit(self):
        policy = json.loads((ROOT / 'config/ai/runtime/runtime-policy.json').read_text(encoding='utf-8'))
        milestones = policy['milestone_policy']
        self.assertFalse(milestones['one_user_continue_or_resume_turn_one_logical_milestone'])
        self.assertTrue(milestones['atomic_milestone_transactions'])
        self.assertTrue(milestones['continue_eligible_milestones_in_same_invocation'])
        self.assertTrue(milestones['stop_only_at_real_authority_or_runtime_boundary'])

    def test_non_developer_owner_never_selects_routine_tasks(self):
        execution = (ROOT / 'AI-NATIVE-EXECUTION.md').read_text(encoding='utf-8')
        supervisor = (ROOT / 'SUPERVISOR.md').read_text(encoding='utf-8')
        self.assertIn('## Non-developer owner: default autonomous engineering mode', execution)
        self.assertIn('No routine owner handoffs', supervisor)
        self.assertIn('independent review', execution)
        self.assertIn('alternative eligible lane', execution)

    def test_progress_is_evidence_based(self):
        state = json.loads((ROOT / 'config/ai/project-state.json').read_text(encoding='utf-8'))
        self.assertEqual(state['next_valid_work_unit'], 'WU-014')
        self.assertEqual(state['progress']['complete'], 3)
        self.assertEqual(state['progress']['total_work_units'], 25)

if __name__ == '__main__':
    unittest.main()
