import { Medal, Trophy } from 'lucide-react'
import { useGame } from '../game/context'
import { Avatar, Card, Notice } from '../components/ui'
import { leaderboard } from '../lib/game'
import { fmtMean } from '../lib/format'

export function LeaderboardPage() {
  const { state, name } = useGame()
  const lb = leaderboard(state.rounds, state.members)
  const medals = ['#c9a227', '#9aa3ab', '#b07247']

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 4 }}>
        <h1>Classifica</h1>
        <p className="muted">Chi porta il gruppo nei posti migliori.</p>
      </div>

      {lb.closedCount === 0 ? (
        <Notice icon={<Trophy size={18} />}>La classifica parte dopo il primo verdetto.</Notice>
      ) : (
        <>
          <Card icon={<Medal size={20} />} title="I posti migliori">
            <div className="list">
              {lb.topPlaces.map((r, i) => (
                <div key={r.id} className="list-item">
                  <Trophy size={22} color={medals[i]} />
                  <div className="grow">
                    <b>{r.place_name}</b>
                    <div className="small muted">
                      Giro {r.number} · {r.proposer_id ? name(r.proposer_id) : 'anonimo'}
                    </div>
                  </div>
                  <span className={`mean ${r.outcome === 'promoted' ? 'ok' : 'bad'}`} style={{ fontSize: '1.25rem' }}>
                    {fmtMean(r.final_mean)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card icon={<Trophy size={20} />} title="I giocatori" sub="Ordinati per premi vinti, poi per media dei posti proposti.">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Giocatore</th>
                    <th className="num">Estratti</th>
                    <th className="num">Premi</th>
                    <th className="num">Bocciati</th>
                    <th className="num">Media</th>
                  </tr>
                </thead>
                <tbody>
                  {lb.rows.map((x) => (
                    <tr key={x.member.user_id}>
                      <td>
                        <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <Avatar name={x.member.display_name} url={x.member.avatar_url} size={26} />
                          <span>
                            {x.member.display_name}
                            {x.member.user_id === state.me.user_id && <span className="muted"> (tu)</span>}
                          </span>
                        </span>
                      </td>
                      <td className="num">{x.drawn}</td>
                      <td className="num">{x.promoted ? <b>{x.promoted}</b> : 0}</td>
                      <td className="num">{x.failed}</td>
                      <td className="num">{fmtMean(x.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lb.anonymous > 0 && (
              <p className="small muted" style={{ marginTop: 10 }}>
                {lb.anonymous === 1 ? '1 posto bocciato resta anonimo' : `${lb.anonymous} posti bocciati restano anonimi`} e non conta per
                nessuno.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
