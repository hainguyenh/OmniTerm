# Code Write Rules

MUST use prettier for formatting.

Each type file in the table below will has type and maximun line of limit. If exceeding this limit, split the code into multiple files:

|Type|Max Line|
|---|---|
|`.ts`|400|
|`.css`|600|
|`.tsx`|500|
|`.rs`|350|
|`.js`|350|

All messages and core repeatable value like constants and enums should be place in a separate file, and the file name should be `constants.ts` or `enums.ts`.