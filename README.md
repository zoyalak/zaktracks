# ZakTracks

Calorie tracking app that estimates the calories in your meal from a food photo and a short text description, using an AI API.

## Why ZakTracks?

Most calorie trackers rely on photos alone, which isn't very accurate. A photo only shows what a meal looks like, not what's in it. It can't tell how much oil was used, whether the sauce is cream-based, or what's hidden inside a wrap or a bowl.

ZakTracks adds a text description to the photo. You describe what's in your meal, and the AI combines that with the image to estimate the calories as accurately as it can. The more detail you give, the better the estimate.

## What it does

- **Calorie estimates:** upload a photo of your meal, add a short description, and get an AI-generated calorie estimate.
- **Meal ideas:** tell the app what ingredients you have and ask the AI what you can make with them.

## How it works

1. You send a food photo and a text description.
2. The app passes both to a vision-capable AI model through [OpenRouter](https://openrouter.ai/).
3. If a model is unavailable or rate-limited, the app falls back to the next model in the chain.
4. The estimated calories are shown back to you.

## Limitations

- Estimates depend on photo quality and how detailed your description is.
- Free-tier AI models have daily request limits, so you may hit them with heavy use.

## Roadmap

- [ ] Save meal history
- [ ] Daily calorie totals
- [ ] More accurate portion estimates
