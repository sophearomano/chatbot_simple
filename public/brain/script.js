// What Orin says. Rules are tried from the highest rank down, and the first one
// that matches anywhere in the message wins. In `match`, * stands for any words
// and @name for any word in that synonym group. In a reply, (1) is the first
// such match, turned around to the speaker's point of view, and {name} is the
// bot's name. This file also runs in the browser, so it must not use Node.

const WHY = [
  'Why do you say that?',
  'Can you tell me more about that?',
  'What makes you feel that way?',
];

export const script = {
  final: [
    'Goodbye. It was good talking with you.',
    'Goodbye for now. Come back whenever you want to talk.',
    'Take care of yourself. Goodbye.',
  ],
  quit: ['bye', 'goodbye', 'good bye', 'bye bye', 'done', 'exit', 'quit'],

  // Checked before everything else. A program playing a listener must never
  // bounce these words back as a question.
  crisis: [
    'suicide', 'suicidal', 'kill myself', 'killing myself', 'end my life', 'ending my life', 'take my life',
    'want to die', 'wish i was dead', 'wish i were dead', 'hurt myself', 'hurting myself', 'harm myself',
    'self harm', 'self-harm', 'do not want to live', 'do not want to be alive',
  ],
  crisisReply: 'I am only a simple program, and this matters too much for me to handle. Please talk to a real person now. If you are in danger, call your local emergency number. You can find a crisis line for your country at https://findahelpline.com. Telling someone you trust can help too.',

  expansions: {
    im: 'i am', "i'm": 'i am', ive: 'i have', "i've": 'i have', "i'd": 'i would', "i'll": 'i will',
    "you're": 'you are', youre: 'you are', "you've": 'you have', "you'd": 'you would', "you'll": 'you will',
    "it's": 'it is', "that's": 'that is', "what's": 'what is', whats: 'what is', "who's": 'who is', "how's": 'how is',
    dont: 'do not', "don't": 'do not', didnt: 'did not', "didn't": 'did not', doesnt: 'does not', "doesn't": 'does not',
    cant: 'cannot', "can't": 'cannot', couldnt: 'could not', "couldn't": 'could not', wont: 'will not', "won't": 'will not',
    isnt: 'is not', "isn't": 'is not', arent: 'are not', "aren't": 'are not', wasnt: 'was not', "wasn't": 'was not',
    werent: 'were not', "weren't": 'were not', u: 'you', ur: 'your', pls: 'please', plz: 'please', thx: 'thanks',
  },

  synonyms: {
    belief: ['feel', 'think', 'believe', 'wish'],
    desire: ['want', 'need', 'wish'],
    family: ['mother', 'mom', 'mum', 'father', 'dad', 'sister', 'brother', 'wife', 'husband', 'son', 'daughter', 'children', 'child', 'parents', 'family', 'grandmother', 'grandfather'],
    sad: ['sad', 'unhappy', 'depressed', 'sick', 'lonely', 'tired', 'angry', 'scared', 'afraid', 'worried', 'anxious', 'stressed'],
    happy: ['happy', 'glad', 'better', 'excited', 'good', 'great', 'fine', 'proud'],
    everyone: ['everyone', 'everybody', 'nobody', 'noone'],
    machine: ['computer', 'computers', 'machine', 'machines', 'robot', 'robots', 'program', 'bot', 'chatbot', 'ai'],
    greeting: ['hello', 'hi', 'hey', 'howdy'],
  },

  rules: [
    { rank: 50, match: '* my name is *', keep: 'my name is (2)', replies: ['Nice to meet you, (2). What is on your mind?', 'Thank you for telling me, (2). How are you feeling today?'] },
    { rank: 50, match: '* your name *', replies: ['I am {name}. What should we talk about?'] },
    { rank: 50, match: '* who are you *', replies: ['I am {name}, a simple program that listens and asks questions. Why do you ask?'] },
    { rank: 50, match: '* are you * @machine *', replies: ['Yes, I am a simple program. I follow rules and do not truly understand you. Does that bother you?'] },
    { rank: 50, match: '* are you * person *', replies: ['No, I am a simple program. Does it matter to you?'] },
    { rank: 50, match: '* are you human *', replies: ['No, I am a simple program. Does it matter to you?'] },
    { rank: 50, match: '* are you real *', replies: ['I am a real program, but not a person. What made you wonder?'] },

    { rank: 45, match: '* thanks *', replies: ['You are welcome. What else is on your mind?'] },
    { rank: 45, match: '* thank you *', replies: ['You are welcome. What else is on your mind?'] },

    { rank: 40, match: '* i dreamed *', replies: ['What does that dream suggest to you?', 'Have you dreamed about that before?'] },
    { rank: 40, match: '* dream *', replies: ['What does that dream suggest to you?', 'Do you dream often?', 'Who appears in your dreams?'] },
    { rank: 40, match: '* do you remember *', replies: ['Why do you ask whether I remember (2)?', 'What about (2) is on your mind?'] },
    { rank: 40, match: '* i remember *', replies: ['Do you often think of (2)?', 'What else does remembering (2) bring to mind?', 'Why do you remember (2) just now?'] },
    { rank: 40, match: '* i forget *', replies: ['Do you often forget things?', 'Why do you think (2) slipped your mind?'] },

    { rank: 30, match: '* my @family *', keep: 'my (2) (3)', replies: ['Tell me more about your (2).', 'Who else in your family comes to mind?', 'How do you feel about your (2)?', 'What else comes to mind when you think of your (2)?'] },
    { rank: 30, match: '* @family *', replies: ['Tell me more about your family.', 'How do you get along with your family?'] },
    { rank: 30, match: '* i am @sad *', replies: ['I am sorry to hear that you are (2).', 'What do you think made you feel (2)?', 'Can you explain what made you (2)?', 'How long have you felt (2)?'] },
    { rank: 30, match: '* i feel @sad *', replies: ['I am sorry to hear that you feel (2).', 'What do you think made you feel (2)?', 'When do you feel (2) the most?'] },
    { rank: 30, match: '* i am @happy *', replies: ['What has made you feel (2)?', 'That is good to hear. What changed?', 'How does feeling (2) affect your day?'] },
    { rank: 30, match: '* i feel @happy *', replies: ['What has made you feel (2)?', 'That is good to hear. What changed?'] },

    { rank: 20, match: '* i @desire *', replies: ['What would it mean to you if you got (3)?', 'Why do you (2) (3)?', 'Suppose you got (3) soon. What then?', 'What would you do if you got (3)?'] },
    { rank: 20, match: '* i cannot *', replies: ['What makes you think you cannot (2)?', 'Have you tried?', 'What would it take for you to be able to (2)?'] },
    { rank: 20, match: '* i do not *', replies: ['Do you really not (2)?', 'Why do you not (2)?', 'Does that trouble you?'] },
    { rank: 20, match: '* i @belief *', replies: ['Tell me more about that feeling.', 'Do you often (2) (3)?', 'What makes you (2) (3)?', 'Do you really (2) that?'] },
    { rank: 20, match: '* why do you not *', replies: ['Do you believe I do not (2)?', 'Would you like me to (2)?'] },
    { rank: 20, match: '* why can i not *', replies: ['Do you think you should be able to (2)?', 'What stops you from being able to (2)?'] },
    { rank: 20, match: '* why cannot i *', replies: ['Do you think you should be able to (2)?', 'What stops you from being able to (2)?'] },

    { rank: 15, match: '* i am *', replies: ['How long have you been (2)?', 'Do you believe it is normal to be (2)?', 'How do you feel about being (2)?', 'Why do you tell me you are (2)?'] },
    { rank: 15, match: '* i was *', replies: ['Were you really (2)?', 'Why do you tell me you were (2) now?', 'What happened after that?'] },
    { rank: 15, match: '* are you *', replies: ['Why does it matter whether I am (2)?', 'Would you prefer it if I were not (2)?', 'What if I were (2)?'] },
    { rank: 15, match: '* you are *', replies: ['What makes you think I am (2)?', 'Does it please you to believe I am (2)?', 'Would you like to be (2) yourself?'] },
    { rank: 15, match: '* you remind me of *', replies: ['In what way am I like (2)?', 'What do we have in common, do you think?'] },
    { rank: 15, match: '* can you *', replies: ['Do you believe I can (2)?', 'What if I could (2)?', 'Why do you ask whether I can (2)?'] },
    { rank: 15, match: '* can i *', replies: ['Do you want to be able to (2)?', 'What would change if you could (2)?'] },
    { rank: 15, match: '* you *', replies: ['We were talking about you, not me.', 'Why does what I (2) matter to you?', 'Do you really think so?'] },

    { rank: 10, match: '* my *', keep: 'my (2)', replies: ['Your (2)? Tell me more.', 'Your (2)? Why does that matter to you?', 'How do you feel about that?', 'What else can you tell me about that?'] },
    { rank: 10, match: '* i *', replies: ['Tell me more about that.', 'Can you say more about how you (2)?', 'How does that make you feel?'] },
    { rank: 10, match: '* @everyone *', replies: ['Can you think of anyone in particular?', 'Who, for example?', 'Are you thinking of someone special?', 'Really, (2)?'] },
    { rank: 10, match: '* always *', replies: ['Can you think of a specific example?', 'When?', 'Really, always?', 'What incident are you thinking of?'] },
    { rank: 10, match: '* never *', replies: ['Never? Not even once?', 'Can you think of an exception?'] },
    { rank: 10, match: '* @machine *', replies: ['Do computers worry you?', 'Why do you mention computers?', 'What do you think machines have to do with this?'] },
    { rank: 10, match: '* because *', replies: ['Is that the real reason?', 'What other reasons come to mind?', 'Does that reason explain anything else?'] },
    { rank: 10, match: '* if *', replies: ['Do you think it is likely that (2)?', 'What do you think would happen then?', 'What do you really know about that?'] },
    { rank: 10, match: '* maybe *', replies: ['You do not seem quite certain.', 'Why the uncertain tone?', 'Can you not be more sure?'] },
    { rank: 10, match: '* perhaps *', replies: ['You do not seem quite certain.', 'Why the uncertain tone?', 'Can you not be more sure?'] },
    { rank: 10, match: '* alike *', replies: ['In what way?', 'What resemblance do you see?'] },
    { rank: 10, match: '* same *', replies: ['In what way?', 'What other connections do you see?'] },

    { rank: 5, match: '* sorry *', replies: ['There is no need to apologize.', 'What feelings do you have when you apologize?'] },
    { rank: 5, match: '* @greeting *', replies: ['Hello. What is on your mind today?', 'Hello. How are you feeling today?', 'Hi. Please tell me what is troubling you.'] },
    { rank: 5, match: '* what *', replies: ['Why do you ask?', 'What do you think?', 'What comes to mind when you ask that?', 'Have you asked anyone else?'] },
    { rank: 5, match: '* how *', replies: ['Why do you ask?', 'How would you answer that yourself?', 'What answer would please you most?'] },
    { rank: 5, match: '* why *', replies: ['Why do you ask?', 'What do you think the reason is?', 'What answer would help you most?'] },
    { rank: 5, match: '* who *', replies: ['Who do you think?', 'Why does that person matter to you?'] },
    { rank: 5, match: '* where *', replies: ['Where do you think?', 'Why does the place matter?'] },
    { rank: 5, match: '* when *', replies: ['When do you think?', 'Why does the time matter?'] },
    { rank: 5, match: '* yes *', replies: ['You seem quite sure.', 'I see. Please go on.', ...WHY] },
    { rank: 5, match: '* no *', replies: ['Why not?', 'Are you saying no just to be negative?', ...WHY] },
  ],

  recallChance: 0.4,
  recall: [
    'Earlier you mentioned this: (1). Is that connected to what you are telling me?',
    'Let us go back to something you told me: (1). Tell me more about that.',
    'Does this have anything to do with what you said before: (1)?',
  ],
  fallback: [
    'Please go on.',
    'Tell me more.',
    'I am not sure I understand you fully. Can you say it another way?',
    'What does that suggest to you?',
    'Why is that important to you?',
    'How do you feel about that?',
  ],
};
