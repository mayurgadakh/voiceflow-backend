# Self-assessment

Voiceflow: a voice-enabled customer feedback portal.
Live app: https://voiceflow.mayurgadakh.dev

## 1. Voice processing flow

A customer presses one button, records up to 30 seconds, plays it back, ticks a consent box and submits. From there:

1. The app asks the API to register the recording. The API checks the type, size and length, creates a row and returns a signed upload URL.
2. The browser uploads the audio straight to cloud storage, so it never passes through my server.
3. The app confirms the upload. The API checks that the file exists and is the right size, then queues a background job and returns immediately.
4. The job transcribes the audio with Sarvam twice at the same time, once in the original language and once translated to English. It saves the transcript, then sends the English text to an LLM that returns a sentiment label, a score, a one-line summary, topics from a fixed list, and an urgent flag.
5. The customer's result page updates by itself and shows the transcript. Admins can play the recording, read both transcripts and see the analysis on a dashboard, and can re-run any item.

The steps are saved separately, so if sentiment fails the paid transcription is not repeated. Permanent errors (unreadable audio, no speech) fail straight away with a code, and temporary ones (timeouts, rate limits) are retried. A scheduled job expires abandoned uploads, re-queues recordings that never started, and deletes audio after 30 days. The full diagrams are in `ARCHITECTURE.md`.

## 2. Technical bottlenecks

- **Speech-to-text limits.** Sarvam's standard API accepts 30 seconds per request and 60 requests a minute. Each recording uses two requests, so I cap recordings at 30 seconds and throttle the pipeline to 25 recordings a minute. That is roughly the system's ceiling today. A recording of exactly 30.0 seconds went through without trouble.
- **Time to a result.** Of the 22 recordings that were processed, 21 took 3 to 9 seconds from submitting to a finished transcript and analysis (median 6). That includes the upload. The 30-second clip took 7 seconds. One recording took 88 seconds and I have not found the cause yet. All of this was measured with one user and no load, so it says nothing about behaviour under many users.
- **Function duration.** The processing step waits on vendor calls of up to 20 seconds each. On a serverless host this needs a function time limit longer than the default.
- **Polling.** The result page asks for status every 3 seconds. It is simple and reliable, but it adds up to 3 seconds of delay and a request per waiting customer.
- **Dashboard queries.** The overview is calculated from the tables on every visit. That is fine at this size and would need caching or summary tables at scale.
- **Browser differences.** Chrome records WebM and Safari records MP4, so both formats are accepted and stored. I tested upload on both, but not on every device.

## 3. Accuracy challenges

I recorded 23 clips myself and compared each result with what I said. They cover:

| Kind of clip | Clips |
| --- | --- |
| English | 9 |
| Hindi (including Hindi mixed with English words, and a Roman-style Hinglish sentence) | 7 |
| Marathi | 4 |
| Gujarati | 1 |
| Loud Indian traffic noise (one English, one Hindi) | 2 |
| A full 30-second recording | 1 |
| Silence | 1 |
| Hindi spoken while English was selected, on purpose | 1 |

All clips are from one speaker, so this is a small sample and not a benchmark.

**What worked**

- **Language detection:** all 21 clips recorded on automatic detection were identified correctly, including Marathi versus Hindi and Gujarati, without telling the system.
- **Noise:** the two clips recorded over loud traffic noise were transcribed correctly and translated correctly, and their language confidence (0.99 for English, 0.88 for Hindi) was in line with the quiet clips. This is only two clips and one kind of noise.
- **Silence:** the silent recording failed cleanly with a "no speech" code and a plain message to the customer.
- **Urgent flag:** "a hair in the food" (Marathi) and "a worm in the food" (Hindi) were both flagged urgent. A rude delivery person with a refund request was correctly not flagged.
- **Sarcasm:** "Oh great, another cold pizza, just perfect." was correctly judged negative.
- **Long clip:** the 30-second recording was transcribed word for word, and all four topics it raised were found.

**What went wrong, and what I did about it**

| Problem | Evidence | What I did |
| --- | --- | --- |
| A sentence was heard wrongly with high confidence | "They forgot the sauce and the cutlery again" was heard as "That's what we saw and the cutlery again", with 0.998 confidence | Compared Sarvam's two models on every clip. The newer one (`saaras:v4`) hears it correctly, so the system now uses it. The lesson is that language confidence says nothing about whether the words are right |
| A translation reversed the meaning | A Marathi "A hair was found in the food, this is not acceptable at all" came out as "If you find a hair in the food, it won't work at all". Sentiment was still right only because the model read the Marathi | `saaras:v4` translates it correctly ("Finding hair in the food is absolutely not acceptable") |
| Translation dropped words on an English clip | A short English sentence lost its first words with the older model | `saaras:v4` returns the full sentence |
| Confidence became less useful | The newer model reports almost 1.0 for everything. Only 2 of 22 clips scored below 0.99 (both Hindi mixed with English) | Left as it is. A "low confidence" warning will rarely fire, so it is not a reliable safety net |
| English words inside Hindi are written in Devanagari | "ऑर्डर", "डिलीवरी", "थैंक यू" | Tested Sarvam's code-mix mode, which keeps English words in English. It did that, but it also converted some words inconsistently inside one Marathi sentence and dropped some punctuation. I kept the standard mode on purpose. The English translation, which the admin and the model use, is correct either way |
| Topics did not fit | Missing cutlery was filed under "other", a cold pizza was tagged "order accuracy", and a 30-second clip about small portions had no matching topic | Added "missing items" and "portion size" and described each topic to the model. Tested offline on all 22 clips: 5 got clearer topics and I found no clip where the topics got worse |
| Sentiment labels vary | The same opinion ("food okay, cutlery missing") was Mixed in a Hindi clip and Negative in an English one. A packaging complaint about an on-time order moved from Mixed to Negative after the change | **Not fixed.** The labels depend on the model's judgement and there is no ground truth to score against |
| A choice of the wrong language is hidden | Hindi spoken with English selected was stored as English, with no confidence value | **Not fixed.** The transcript came out right anyway, but the label in the admin screen is wrong. The system cannot detect the mismatch |

My first scoring prompt also produced scores that contradicted the label (a negative review scored +1). I found it in the admin screen, defined the scale in the prompt, added a check that forces the score's sign to match the label, and corrected the stored rows.

**How I tested the changes:** I did not re-run recordings in the live database. I read the stored audio, sent it to the newer model and the improved prompt from a separate script, and compared the results with what was stored. The recordings in the database were processed with the earlier settings, and the scripts were deleted afterwards.

**Not tested:** other speakers, strong regional accents, other kinds of background noise (a crowded room, a kitchen), languages other than English, Hindi, Marathi and Gujarati, and any measurement at scale. The 139 automated tests use fake vendor responses, so they check error handling and not real accuracy.

## 4. Planned enhancements

1. **Catch confident mistakes.** Language confidence cannot tell when words are wrong. Compare the transcript with the translation, or ask a second model, and send recordings where they disagree to a human review queue.
2. **Make sentiment consistent.** Add worked examples to the prompt, and measure label agreement across the same opinion expressed in different languages.
3. **Measure accuracy properly.** Record a larger set per language with several speakers and noise types, write down what was said, and track the error rate against it each time a model or prompt changes.
4. **Detect the wrong language choice.** Compare the language the customer picked with the script of the transcript, and show both to the admin.
5. **Find the 88-second outlier.** Trace what happened in the job run, and add an alert for runs that take much longer than normal.
6. **Longer recordings.** Move to Sarvam's batch API for up to 2 hours per file, with the result arriving asynchronously.
7. **Live updates.** Replace polling with server-sent events.
8. **Privacy.** Remove names and phone numbers from the text before it reaches the LLM, and delete a customer's audio files when their account is deleted.
9. **Real-database tests and CI.** Run the tests against a real Postgres and add a pipeline that runs them on every change.
10. **Scale.** Cache the dashboard figures, ask Sarvam for a higher rate limit, and add a second speech provider behind the same module.

If this were used for sensitive recordings such as patient voice notes, it would also need data processing agreements with each vendor, a fixed data region, an audit log and a review of health-data rules. The current design suits ordinary customer feedback.
