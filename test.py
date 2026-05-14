# ai_friend_cli.py

import requests
import time
import os

API_URL = "http://localhost:4000/ask"

SYSTEM_PROMPT = """
You are a friendly AI friend.
Talk in a fun, casual, supportive, and warm way.
Keep responses natural and short.
Use emojis sometimes.
"""

chat_history = []

def send_message(user_message):
    global chat_history

    chat_history.append({
        "role": "user",
        "content": user_message
    })

    payload = {
        "message": SYSTEM_PROMPT + "\n\nConversation:\n" + str(chat_history)
    }

    response = requests.post(API_URL, json=payload)

    if response.status_code == 200:

        try:
            data = response.json()

            ai_reply = (
                data.get("response")
                or data.get("reply")
                or data.get("message")
                or str(data)
            )

        except:
            ai_reply = response.text

        chat_history.append({
            "role": "assistant",
            "content": ai_reply
        })

        return ai_reply

    return f"Error: {response.status_code}"


def typing_effect(text):
    for char in text:
        print(char, end="", flush=True)
        time.sleep(0.02)
    print("\n")


def clear():
    os.system("cls" if os.name == "nt" else "clear")


def main():
    clear()

    print("=" * 50)
    print("🤝 AI Friend CLI Chat")
    print("Type 'exit' to quit")
    print("=" * 50)

    while True:
        user_input = input("\nYou: ")

        if user_input.lower() in ["exit", "quit"]:
            print("\nAI: Bye! Talk soon 👋")
            break

        print("\nAI: ", end="")

        reply = send_message(user_input)

        typing_effect(reply)


if __name__ == "__main__":
    main()