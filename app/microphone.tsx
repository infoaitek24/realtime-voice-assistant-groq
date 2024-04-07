import { useState, useEffect, useCallback } from "react";
import { useQueue } from "@uidotdev/usehooks";
import Dg from "./dg.svg"; // Ensure this SVG import path is correct
import Recording from "./recording.svg"; // Ensure this SVG import path is correct
import axios from "axios";
import Siriwave from 'react-siriwave';
import ChatGroq from "groq-sdk"; // Ensure this import is correctly set up according to your project structure
import { CreateProjectKeyResponse, LiveClient, LiveTranscriptionEvents, createClient } from "@deepgram/sdk";

export default function Microphone() {
  const { add, remove, first, size, queue } = useQueue<any>([]);
  const [apiKey, setApiKey] = useState<CreateProjectKeyResponse | null>();
  const [neetsApiKey, setNeetsApiKey] = useState<string | null>();
  const [groqClient, setGroqClient] = useState<ChatGroq>();
  const [connection, setConnection] = useState<LiveClient | null>();
  const [isListening, setListening] = useState(false);
  const [isLoadingKey, setLoadingKey] = useState(true);
  const [isLoading, setLoading] = useState(true);
  const [isProcessing, setProcessing] = useState(false);
  const [micOpen, setMicOpen] = useState(false);
  const [microphone, setMicrophone] = useState<MediaRecorder | null>();
  const [userMedia, setUserMedia] = useState<MediaStream | null>();
  const [caption, setCaption] = useState<string | null>();
  const [audioQueue, setAudioQueue] = useState([]); // Queue to manage audio playback
  const [isAudioPlaying, setAudioPlaying] = useState(false); // State to track audio playback

  const toggleMicrophone = useCallback(async () => {
    if (microphone && userMedia) {
      setUserMedia(null);
      setMicrophone(null);
      microphone.stop();
    } else {
      const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
      const microphone = new MediaRecorder(userMedia);
      microphone.start(500);

      microphone.onstart = () => setMicOpen(true);
      microphone.onstop = () => setMicOpen(false);
      microphone.ondataavailable = (e) => add(e.data);

      setUserMedia(userMedia);
      setMicrophone(microphone);
    }
  }, [add, microphone, userMedia]);

  useEffect(() => {
    const fetchGroqClient = async () => {
      if (!groqClient) {
        try {
          const res = await fetch("/api/groq", { cache: "no-store" });
          const object = await res.json();
          const groq = new ChatGroq({ apiKey: object.apiKey, dangerouslyAllowBrowser: true});
          setGroqClient(groq);
          setLoadingKey(false);
        } catch (e) {
          console.error(e);
        }
      }
    };

    fetchGroqClient();
  }, [groqClient]);

  useEffect(() => {
    const fetchNeetsApiKey = async () => {
      if (!neetsApiKey) {
        try {
          const res = await fetch("/api/neets", { cache: "no-store" });
          const object = await res.json();
          if (!object.apiKey) throw new Error("No api key returned");
          setNeetsApiKey(object.apiKey);
          setLoadingKey(false);
        } catch (e) {
          console.error(e);
        }
      }
    };

    fetchNeetsApiKey();
  }, [neetsApiKey]);

  useEffect(() => {
    const fetchApiKey = async () => {
      if (!apiKey) {
        try {
          const res = await fetch("/api", { cache: "no-store" });
          const object = await res.json();
          if (!object.key) throw new Error("No api key returned");
          setApiKey(object);
          setLoadingKey(false);
        } catch (e) {
          console.error(e);
        }
      }
    };

    fetchApiKey();
  }, [apiKey]);

  useEffect(() => {
    if (apiKey && "key" in apiKey) {
      const deepgram = createClient(apiKey.key);
      const connection = deepgram.listen.live({
        model: "nova",
        interim_results: false,
        language: "en-US",
        smart_format: true,
      });

      connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("connection established");
        setListening(true);
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        console.log("connection closed");
        setListening(false);
        setApiKey(null);
        setConnection(null);
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const words = data.channel.alternatives[0].words;
        const caption = words.map((word) => word.punctuated_word ?? word.word).join(" ");
        if (caption !== "") {
          setCaption(caption);
          if (data.is_final && groqClient && neetsApiKey) {
            groqClient.chat.completions.create({
              messages: [
                {
                  role: "user",
                  content: caption,
                }
              ],
              model: "mixtral-8x7b-32768",
            }).then((chatCompletion) => {
              axios.post("https://api.neets.ai/v1/tts", {
                text: chatCompletion.choices[0]?.message?.content || "",
                voice_id: 'us-female-2',
                params: {
                  model: 'style-diff-500'
                }
              }, {
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': neetsApiKey
                },
                responseType: 'arraybuffer'
              }).then((response) => {
                const blob = new Blob([response.data], { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                setAudioQueue((prevQueue) => [...prevQueue, url]); // Add the new audio URL to the queue
              }).catch((error) => {
                console.error(error);
              });
            });
          }
        }
      });

      setConnection(connection);
      setLoading(false);
    }
  }, [apiKey, groqClient, neetsApiKey]);

  useEffect(() => {
    // This effect processes the audio queue
    if (audioQueue.length > 0 && !isAudioPlaying) {
      setAudioPlaying(true); // Mark as playing
      const currentAudioUrl = audioQueue[0]; // Get the first audio URL from the queue
      const audio = new Audio(currentAudioUrl);
      audio.play(); // Play the audio
      audio.onended = () => {
        // Once audio ends, remove it from the queue and mark audio as not playing
        setAudioQueue((prevQueue) => prevQueue.slice(1));
        setAudioPlaying(false);
      };
    }
  }, [audioQueue, isAudioPlaying]);

  useEffect(() => {
    const processQueue = async () => {
      if (size > 0 && !isProcessing) {
        setProcessing(true);

        if (isListening) {
          const blob = first;
          connection?.send(blob);
          remove();
        }

        const waiting = setTimeout(() => {
          clearTimeout(waiting);
          setProcessing(false);
        }, 250);
      }
    };

    processQueue();
  }, [connection, queue, remove, first, size, isProcessing, isListening]);

  if (isLoadingKey) return <span className="w-full text-center">Loading temporary API key...</span>;
  if (isLoading) return <span className="w-full text-center">Loading the app...</span>;

  return (
    <div className="w-full relative">
      <div className="relative flex justify-center items-center max-w-screen-lg">
        <Siriwave theme="ios9" autostart={isAudioPlaying} />
      </div>
      <div className="mt-10 flex flex-col items-center">
        <button className="w-24 h-24" onClick={toggleMicrophone}>
          {/* Ensure you have the `Recording` SVG or replace this with an appropriate element */}
          <img src={Recording} alt="Toggle Microphone" />
        </button>
        <div className="mt-20 p-6 text-xl text-center">{caption}</div>
      </div>
    </div>
  );
}
