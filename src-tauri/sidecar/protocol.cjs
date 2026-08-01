/**
 * protocol.cjs — Line-delimited JSON-RPC 2.0 over process.stdin / process.stdout
 */
const readline = require('readline')

class JsonRpcProtocol {
  constructor({ input = process.stdin, output = process.stdout, onParseError = null } = {}) {
    this.requestId = 1
    this.pendingRequests = new Map()
    this.requestHandler = null
    this.notificationHandler = null
    this.output = output
    this.onParseError = onParseError

    const rl = readline.createInterface({ input, output, terminal: false })
    rl.on('line', (line) => this._handleLine(line))
  }

  _handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      void this._handleMessage(JSON.parse(trimmed))
    } catch (error) {
      if (this.onParseError) this.onParseError(error, line)
      else console.error('[protocol] Failed to parse line as JSON-RPC:', error, line)
    }
  }

  onNotification(handler) {
    this.notificationHandler = handler
  }

  onRequest(handler) {
    this.requestHandler = handler
  }

  sendNotification(method, params) {
    this._write({ jsonrpc: '2.0', method, params })
  }

  sendResponse(id, result, error) {
    const msg = { jsonrpc: '2.0', id }
    if (error) {
      msg.error = typeof error === 'string' ? { code: -32603, message: error } : error
    } else {
      msg.result = result !== undefined ? result : null
    }
    this._write(msg)
  }

  callRemote(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++
      this.pendingRequests.set(id, { resolve, reject })
      this._write({ jsonrpc: '2.0', id, method, params })
    })
  }

  _write(msg) {
    this.output.write(`${JSON.stringify(msg)}\n`)
  }

  async _handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return

    // Response handling
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'RPC Error'))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // Incoming Request handling
    if (msg.method && msg.id !== undefined) {
      if (this.requestHandler) {
        try {
          const res = await this.requestHandler(msg.method, msg.params)
          this.sendResponse(msg.id, res, null)
        } catch (err) {
          this.sendResponse(msg.id, null, err.message || String(err))
        }
      } else {
        this.sendResponse(msg.id, null, `Method "${msg.method}" not found`)
      }
      return
    }

    // Incoming Notification handling
    if (msg.method && msg.id === undefined && this.notificationHandler) {
      this.notificationHandler(msg.method, msg.params)
    }
  }
}

module.exports = { JsonRpcProtocol }
