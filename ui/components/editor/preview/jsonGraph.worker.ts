import { handleJsonGraphRequest } from './jsonGraphTask'
import { respond } from './workerProtocol'

// Worker entry: parse and lay out the JSON graph off the main thread.
addEventListener('message', (event: MessageEvent<unknown>) => {
  const { message, transfer } = respond(event.data, handleJsonGraphRequest)
  postMessage(message, { transfer })
})
