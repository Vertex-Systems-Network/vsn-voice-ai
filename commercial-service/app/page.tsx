export default function Home() {
  return <main>
    <h1>ANPOS Commercial Service</h1>
    <p>This service handles GitHub Marketplace entitlement reconciliation and signed commercial entitlements.</p>
    <p><a href="/community">ANPOS Community repository audit</a> · <a href="/team">ANPOS Team organization administration</a></p>
    <p>Operational endpoints: <code>/api/health</code> and <code>/api/ready</code>.</p>
    <p>GitHub Marketplace remains billing authority. Team administration is available only to a reconciled organization entitlement with <code>organization_team_features</code>.</p>
    <p>No customer project is remotely deleted, encrypted, or intentionally broken when a commercial entitlement expires.</p>
  </main>;
}
