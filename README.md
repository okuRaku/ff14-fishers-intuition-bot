# Fisher's Intuition
This Discord bot acts as a front end to another app (publishing Soon&trade;) that provides upcoming fishing windows in the critically acclaimed MMORPG Final Fantasy XIV.

On a server that the commands have been registered and the bot added, start by simply typing `/windows`.   Five parameters are currently offered, one required.

| Parameter  | Type  | Default value | Description  |
|--|--|---|---|
|  `fish` | String |   | **Required.**  Desired fish, any language, exact spelling. |
|  `number_of_windows` | Number| 5 | Optional.  How many upcoming windows to show.  Minimum 1, maximum 10.   |
| `display_duration`  | Boolean | False |  Optional.  Display window durations, useful on fish where it can vary.  |
| `display_downtime`  | Boolean | True | Optional.  Display downtime between windows, varies due to weather randomness.  |
| `compact_mode`  | Boolean | True| Optional.  Compact view more suitable for mobile.  |

![Discord screenshot](screenshot1.png "Screenshot")



*FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd.
FINAL FANTASY XIV © 2010 - 2021 SQUARE ENIX CO., LTD. All Rights Reserved.*
