import { handleCsvRequest } from './csvParse'
import { respond } from './workerProtocol'

// Worker entry: index CSV rows off the main thread; the row offsets are transferred, not copied.
addEventListener('message', (event: MessageEvent<unknown>) => {
  const { message, transfer } = respond(event.data, handleCsvRequest)
  postMessage(message, { transfer })
})
