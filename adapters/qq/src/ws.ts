import { Adapter, Logger, Schema } from '@satorijs/satori'
import { QQBot } from './bot'
import { Intents, Opcode, Payload } from './types'
import { adaptSession, decodeUser } from './utils'

const logger = new Logger('qq')

export class WsClient extends Adapter.WsClient<QQBot> {
  _sessionId = ''
  _s: number = null
  _ping: NodeJS.Timeout

  async prepare() {
    const { url } = await this.bot.guildHttp.get(`/gateway`)
    logger.debug('url: %s', url)
    return this.bot.guildHttp.ws(url)
  }

  heartbeat() {
    this.socket.send(JSON.stringify({
      op: Opcode.HEARTBEAT,
      s: this._s,
    }))
  }

  async accept() {
    this.socket.addEventListener('message', async ({ data }) => {
      const parsed: Payload = JSON.parse(data.toString())
      logger.debug(require('util').inspect(parsed, false, null, true))
      if (parsed.op === Opcode.HELLO) {
        if (this._sessionId) {
          this.socket.send(JSON.stringify({
            op: Opcode.RESUME,
            d: {
              token: `Bot ${this.bot.config.id}.${this.bot.config.token}`,
              session_id: this._sessionId,
              seq: this._s,
            },
          }))
        } else {
          this.socket.send(JSON.stringify({
            op: Opcode.IDENTIFY,
            d: {
              token: `Bot ${this.bot.config.id}.${this.bot.config.token}`,
              intents: this.bot.config.type === 'private' ? Intents.GUILD_MESSAGES : Intents.PUBLIC_GUILD_MESSAGES,
            },
          }))
        }
        this._ping = setInterval(() => this.heartbeat(), parsed.d.heartbeat_interval)
      } else if (parsed.op === Opcode.INVALID_SESSION) {
        this._sessionId = ''
        this._s = null
        logger.warn('offline: invalid session')
        this.socket?.close()
      } else if (parsed.op === Opcode.RECONNECT) {
        logger.warn('offline: server request reconnect')
        this.socket?.close()
      } else if (parsed.op === Opcode.DISPATCH) {
        this.bot.dispatch(this.bot.session({
          type: 'internal',
          _type: 'qq/' + parsed.t.toLowerCase().replace(/_/g, '-'),
          _data: parsed,
        }))
        this._s = parsed.s
        if (parsed.t === 'READY') {
          this._sessionId = parsed.d.session_id
          this.bot.user = decodeUser(parsed.d.user)
          return this.bot.online()
        }
        if (parsed.t === 'RESUMED') {
          return this.bot.online()
        }
        const session = await adaptSession(this.bot, parsed)
        if (session) this.bot.dispatch(session)
        logger.debug(require('util').inspect(session, false, null, true))
      }
    })

    this.socket.addEventListener('close', (e) => {
      clearInterval(this._ping)
    })
  }
}

export namespace WsClient {
  export interface Config extends Adapter.WsClientConfig { }

  export const Config: Schema<Config> = Schema.intersect([
    Adapter.WsClientConfig,
  ])
}
